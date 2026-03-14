"""
backend/main.py
FastAPI server + WebSocket endpoint for Axis.
"""
import os
from dotenv import load_dotenv
load_dotenv()  # Load .env before any ADK/google imports

# Force Vertex AI Auth
from backend.config import settings
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", settings.google_cloud_project)
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", settings.google_cloud_location)
# GOOGLE_APPLICATION_CREDENTIALS: set via .env for local development;
# on Cloud Run, ADC is provided by the attached Service Account automatically.

import asyncio
import base64
import copy
import json
import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional
import io
import csv
from pypdf import PdfReader

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from google.adk.agents import Agent, LiveRequestQueue
from google.adk.agents.run_config import RunConfig
from google.adk.runners import InMemoryRunner
from google.genai import types
from google.genai.types import Blob
import google.genai as genai
from google.genai.errors import APIError, ClientError

from agent.Axis_agent import SYSTEM_PROMPT, root_agent
from backend.firestore_client import firestore_client
from backend.email_service import send_feedback_email

logger = logging.getLogger(__name__)

# --- Vertex AI Client for Image Generation ---
vertex_client = genai.Client(
    vertexai=True,
    project=settings.google_cloud_project,
    location=settings.google_cloud_location
)

# --- Logging: console + rotating file ---
import pathlib as _pathlib
from logging.handlers import RotatingFileHandler as _RFH
_log_dir = _pathlib.Path(__file__).parent.parent / "logs"
_log_dir.mkdir(exist_ok=True)
_log_file = _log_dir / "axis.log"
_fmt = logging.Formatter("%(asctime)s | %(levelname)-5s | %(name)s | %(message)s", datefmt="%H:%M:%S")
_fh = _RFH(_log_file, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8")
_fh.setFormatter(_fmt)
_fh.setLevel(logging.DEBUG)
_sh = logging.StreamHandler()
_sh.setFormatter(_fmt)
_sh.setLevel(logging.INFO)
logging.basicConfig(level=logging.INFO, handlers=[_sh, _fh])
logging.getLogger("google_adk").setLevel(logging.WARNING)
logging.getLogger("websockets").setLevel(logging.WARNING)
logging.getLogger("google.genai").setLevel(logging.WARNING)

class ADKDisconnectFilter(logging.Filter):
    def filter(self, record):
        return "1000" not in str(record.msg) and "1000" not in str(getattr(record, "exc_info", ""))

logging.getLogger("google_adk.google.adk.flows.llm_flows.base_llm_flow").addFilter(ADKDisconnectFilter())

# Regex pattern to detect internal monologue / non-English hallucination output
_MONOLOGUE_RE = re.compile(
    r"\*\*Ignoring|\*\*Awaiting|<noise>|<silence>"
    r"|^[\s*_~`#>|-]+$",  # lines composed entirely of markdown formatting chars
    re.IGNORECASE,
)


def _sanitize_agent_text(text: str) -> str:
    forbidden = ['ASGI', 'websocket', 'Exception', 'Traceback']
    if any(f.lower() in text.lower() for f in forbidden):
        return 'Action could not be completed.'
    # Fix run-on words from streaming concatenation (e.g. "OkayYou're")
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    return text

def _is_internal_monologue(text: str) -> bool:
    """Return True if *text* looks like model internal thinking / non-English hallucination."""
    if not text or not text.strip():
        return False
    stripped = text.strip()
    if stripped.count("*") >= 4 and (stripped.count("*") / max(len(stripped), 1)) > 0.3:
        return True
    return bool(_MONOLOGUE_RE.search(stripped))


# ---------------------------------------------------------------------------
# Persona prefixes for agent customization
# ---------------------------------------------------------------------------
PERSONA_PREFIXES = {
    "Pilot": "You are Pilot, a precise and professional AI browser co-pilot.",
    "Sage": "You are Sage, a wise and methodical AI assistant who thinks before acting.",
    "Scout": "You are Scout, a fast and efficient AI agent who acts immediately.",
    "Companion": "You are a friendly and encouraging AI helper named Aria.",
    "Expert": "You are an expert technical AI agent with deep knowledge of web interfaces.",
}


def _has_non_latin(text: str) -> bool:
    """Return True if text contains non-Latin characters."""
    return bool(re.search(r'[^\x00-\x7F]', text))


def _is_transcription_noise(text: str) -> bool:
    """Return True if text is likely transcription noise — very short non-Latin
    fragments that Gemini Live's audio layer misclassifies from ambient sound.
    These must be filtered BEFORE reaching the model to prevent language switching.
    
    Less aggressive: only filters single-character non-Latin fragments.
    Multi-character non-Latin strings (e.g. real words in other languages) are allowed.
    """
    if not text:
        logger.debug("noise_filter: empty text -> noise")
        return True
    stripped = text.strip()
    if not stripped:
        logger.debug("noise_filter: whitespace-only text -> noise")
        return True
    # Only filter single non-Latin character fragments (likely mic artefacts)
    if len(stripped) == 1 and _has_non_latin(stripped):
        ascii_chars = sum(1 for c in stripped if ord(c) < 128 and c.isalpha())
        if ascii_chars == 0:
            logger.info(f"noise_filter: suppressed single non-Latin char: '{stripped}'")
            return True
    return False


async def _generate_session_headline(transcript: list) -> str:
    """Use Gemini to summarise last 10 transcript messages into <=6 words."""
    try:
        last_msgs = transcript[-10:] if len(transcript) > 10 else transcript
        if not last_msgs:
            return "Empty session"
        convo = "\n".join(f"{m.get('role','?')}: {m.get('text','')}" for m in last_msgs)
        client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"Summarize this browser session in 6 words or less. Reply with ONLY the summary, nothing else.\n\n{convo}",
        )
        headline = response.text.strip()[:60] if response.text else "Browser session"
        return headline
    except Exception as e:
        logger.error(f"_generate_session_headline error: {e}")
        return "Browser session"


def _prune_context(history: list, max_turns: int = 20):
    """
    Rolling context window:
    1. Only keep the VERY LAST image (Blob) in history.
    2. Replace older Blobs with text: [Previous screenshot omitted to save memory].
    3. Trim history to last N turns.
    """
    if not history:
        return

    # 1. Prune Images: iterate backwards, keep first image found, strip others
    image_found = False
    # Use a faster iteration and avoid excessive hasattr checks if possible
    for i in range(len(history) - 1, -1, -1):
        content = history[i]
        parts = getattr(content, 'parts', []) if not isinstance(content, dict) else content.get('parts', [])
        
        if not parts:
            continue
            
        modified = False
        new_parts = []
        for part in parts:
            is_image = False
            # Streamlined check for image blobs
            if isinstance(part, dict):
                if part.get('inline_data') or part.get('data'): is_image = True
            else:
                if (getattr(part, 'inline_data', None) or getattr(part, 'data', None)): is_image = True
            
            if is_image:
                if not image_found:
                    new_parts.append(part)
                    image_found = True
                else:
                    new_parts.append(types.Part.from_text(text="[Previous screenshot omitted to save memory]"))
                    modified = True
            else:
                new_parts.append(part)
        
        if modified:
            if hasattr(content, 'parts'):
                content.parts = new_parts
            elif isinstance(content, dict):
                content['parts'] = new_parts

    # 2. Trim Turns
    if len(history) > max_turns:
        history[:] = history[-max_turns:]
        logger.info(f"Pruned history to {len(history)} turns")



# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------

class SessionState:
    """Per-session state holding WebSocket, ADK runner, and pending futures."""

    def __init__(self, session_id: str, websocket: WebSocket):
        self.session_id = session_id
        self.websocket = websocket
        self.session_active = True
        self.user_id: Optional[str] = None
        self.user_email: Optional[str] = None
        self.user_display_name: Optional[str] = None
        self.tab_id: Optional[str] = None

        # Agent customization
        self.agent_voice: str = "Aoede"
        self.agent_persona: str = "Axis"  # Renamed from Pilot
        self.custom_instructions: str = ""
        self.chat_history: list[types.Content] = []  # Added for context management

        # Page context
        self.page_url: str = ""
        self.page_title: str = ""
        self.webmcp_available: bool = False
        self.webmcp_tools: list = []
        self.selected_tabs: list = []  # Restricted tabs list from extension

        # Document context
        self.documents: dict = {}

        # Futures for tool <-> extension communication
        self._screenshot_future: Optional[asyncio.Future] = None
        self._action_future: Optional[asyncio.Future] = None
        self._browser_future: Optional[asyncio.Future] = None

        # Predictive Screenshot Cache
        self.cached_screenshot: Optional[str] = None
        self.screenshot_cached_at: float = 0.0
        self._predicting_screenshot: bool = False

        # Language noise tracking — last finalized input transcription
        self._last_input_text: str = ""

        # ADK runner (created in initialize after auth)
        self.runner = None
        self.adk_session = None
        self.live_request_queue: Optional[LiveRequestQueue] = None
        self.live_events = None
        self.initialized_event = asyncio.Event()
        
        # Throttling
        self._chat_throttle_timestamps: list[float] = []
        self._audio_throttle_timestamps: list[float] = []

    async def initialize(self):
        """Create per-session agent with persona, then start bidi live stream."""
        if self.initialized_event.is_set():
            return

        # Build per-session agent with persona prefix
        persona_prefix = PERSONA_PREFIXES.get(self.agent_persona, PERSONA_PREFIXES["Pilot"])
        effective_prompt = persona_prefix + "\n\n" + SYSTEM_PROMPT

        # Insert custom instructions before the SECURITY section
        if self.custom_instructions:
            security_marker = "SECURITY — NON-NEGOTIABLE"
            security_idx = effective_prompt.find(security_marker)
            if security_idx > 0:
                effective_prompt = (
                    effective_prompt[:security_idx]
                    + f"USER CUSTOM INSTRUCTIONS:\n{self.custom_instructions}\n\n"
                    + effective_prompt[security_idx:]
                )
            else:
                effective_prompt += f"\n\nUSER CUSTOM INSTRUCTIONS:\n{self.custom_instructions}"

        session_agent = Agent(
            name="axis",
            model="gemini-live-2.5-flash-native-audio",
            description="Axis: voice-driven browser UI navigator",
            instruction=effective_prompt,
            tools=root_agent.tools,
        )

        self.runner = InMemoryRunner(
            app_name="axis",
            agent=session_agent,
        )

        try:
            self.adk_session = await self.runner.session_service.create_session(
                app_name="axis",
                user_id=self.user_id or "anonymous",
            )

            self.live_request_queue = LiveRequestQueue()

            run_config = RunConfig(
                streaming_mode="bidi",
                realtime_input_config=types.RealtimeInputConfig(
                    automatic_activity_detection=types.AutomaticActivityDetection(
                        start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                        end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                        prefix_padding_ms=200,
                        silence_duration_ms=300,
                    )
                ),
                response_modalities=[types.Modality.AUDIO],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=self.agent_voice
                        )
                    ),
                    language_code="en-US",
                ),
                output_audio_transcription={},
                input_audio_transcription={},
            )

            self.live_events = self.runner.run_live(
                session=self.adk_session,
                live_request_queue=self.live_request_queue,
                run_config=run_config,
            )
        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                logger.error(f"Quota error during live init: {error_str}")
                # We'll let the event set so the messaging loop can handle it or the error is logged.
                # But actually, if this fails, we should probably set a flag or just let it be.
            raise e
        finally:
            self.initialized_event.set()

    # -- screenshot future pattern ------------------------------------------

    async def request_screenshot(
        self, session_id: str, tab_id: str, timeout: float = 5.0
    ) -> Optional[str]:
        import time as _time
        _t0 = _time.monotonic()
        # Check for restricted URL or tab early to avoid unnecessary WebSocket roundtrips
        restricted_prefixes = ["chrome://", "about:", "chrome-extension://", "edge://"]
        current_url = self.page_url.lower() if self.page_url else ""
        is_chrome_page = any(current_url.startswith(p) for p in restricted_prefixes) or not current_url
        is_restricted_tab = any(str(t.get('id')) == str(self.tab_id) for t in self.selected_tabs)

        if is_chrome_page:
            return "CHROME_INTERNAL_PAGE: Screenshots unavailable on internal pages."
        if is_restricted_tab:
            return "TAB_RESTRICTED: This tab is restricted by the user."

        # RETURN CACHED IF VALID (under 3 seconds old)
        now = asyncio.get_event_loop().time()
        if self.cached_screenshot and (now - self.screenshot_cached_at) < 3.0:
            logger.info(f"[screenshot] Using cached ({_time.monotonic()-_t0:.0f}ms) session={session_id}")
            cached = self.cached_screenshot
            self.cached_screenshot = None  # Consume the cache
            return cached

        self._screenshot_future = asyncio.get_event_loop().create_future()
        try:
            await self.websocket.send_json({"type": "request_screenshot"})
        except Exception:
            pass
        try:
            result = await asyncio.wait_for(self._screenshot_future, timeout=timeout)
            if isinstance(result, str) and result.startswith("ERROR:"):
                logger.warning(f"[screenshot] FAILED ({result}) session={session_id}")
                return None
            logger.info(f"[screenshot] Captured ({_time.monotonic()-_t0:.1f}s) session={session_id}")
            return result
        except asyncio.TimeoutError:
            logger.warning(f"[screenshot] TIMEOUT ({timeout}s) session={session_id}")
            return None
        finally:
            self._screenshot_future = None

    def trigger_predictive_screenshot(self):
        """Called when user starts speaking to fetch a screenshot early."""
        if self._predicting_screenshot or self._screenshot_future:
            return
        self._predicting_screenshot = True
        logger.info("Triggering predictive screenshot...")
        asyncio.create_task(self._do_predictive_screenshot())

    async def _do_predictive_screenshot(self):
        try:
            self._screenshot_future = asyncio.get_event_loop().create_future()
            await self.websocket.send_json({"type": "request_screenshot"})
            result = await asyncio.wait_for(self._screenshot_future, timeout=5.0)
            if result:
                self.cached_screenshot = result
                self.screenshot_cached_at = asyncio.get_event_loop().time()
        except Exception as e:
            logger.debug(f"Predictive screenshot failed or timed out: {e}")
        finally:
            self._screenshot_future = None
            self._predicting_screenshot = False

    def resolve_screenshot(self, data: str, success: bool = True):
        if self._screenshot_future and not self._screenshot_future.done():
            if success:
                self._screenshot_future.set_result(data)
                logger.debug(f"[screenshot] resolved, size={len(data)} chars")
            else:
                self._screenshot_future.set_result(f"ERROR: {data}")
                logger.warning(f"[screenshot] resolved with error: {data}")

    # -- webmcp future pattern ----------------------------------------------

    async def execute_webmcp(
        self, session_id: str, tab_id: str, tool_name: str, args: dict, timeout: float = 8.0,
    ) -> dict:
        self._action_future = asyncio.get_event_loop().create_future()
        try:
            await self.websocket.send_json(
                {"type": "execute_webmcp", "tool_name": tool_name, "args": args}
            )
        except Exception:
            pass
        try:
            return await asyncio.wait_for(self._action_future, timeout=timeout)
        except asyncio.TimeoutError:
            return {"success": False, "error": "WebMCP execution timed out"}
        finally:
            self._action_future = None

    # -- dom action future pattern ------------------------------------------

    async def execute_dom(
        self, session_id: str, tab_id: str, selector: str, action: str, value: Optional[str], timeout: float = 5.0,
    ) -> dict:
        self._action_future = asyncio.get_event_loop().create_future()
        try:
            await self.websocket.send_json(
                {"type": "execute_dom", "selector": selector, "action": action, "value": value}
            )
        except Exception:
            pass
        try:
            return await asyncio.wait_for(self._action_future, timeout=timeout)
        except asyncio.TimeoutError:
            return {"success": False, "error": "DOM action timed out"}
        finally:
            self._action_future = None

    async def get_interactive_elements(
        self, session_id: str, tab_id: str, timeout: float = 5.0,
    ) -> dict:
        """Ask the content script to scan the DOM for visible interactive elements."""
        self._action_future = asyncio.get_event_loop().create_future()
        try:
            await self.websocket.send_json({"type": "get_interactive_elements"})
        except Exception:
            pass
        try:
            return await asyncio.wait_for(self._action_future, timeout=timeout)
        except asyncio.TimeoutError:
            return {"success": False, "error": "Interactive elements scan timed out"}
        finally:
            self._action_future = None

    def resolve_action(self, result: dict):
        if self._action_future and not self._action_future.done():
            self._action_future.set_result(result)

    def resolve_browser(self, result: dict):
        if self._browser_future and not self._browser_future.done():
            self._browser_future.set_result(result)

    def close(self):
        logger.info(f"[session] Closing session={self.session_id}")
        self.session_active = False
        if self.live_request_queue:
            self.live_request_queue.close()
        for fut in [self._screenshot_future, self._action_future, self._browser_future]:
            if fut and not fut.done():
                fut.cancel()

    async def restart_live_stream(self):
        """Restart the ADK bidi live stream after a disconnect."""
        logger.info(f"[session] Restarting live stream for session={self.session_id}")
        # Close old queue gracefully
        if self.live_request_queue:
            try:
                self.live_request_queue.close()
            except Exception:
                pass

        self.live_request_queue = LiveRequestQueue()

        run_config = RunConfig(
            streaming_mode="bidi",
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                    prefix_padding_ms=200,
                    silence_duration_ms=300,
                )
            ),
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=self.agent_voice
                    )
                ),
                language_code="en-US",
            ),
            output_audio_transcription={},
            input_audio_transcription={},
        )

        self.live_events = self.runner.run_live(
            session=self.adk_session,
            live_request_queue=self.live_request_queue,
            run_config=run_config,
        )
        logger.info(f"[session] Live stream restarted for session={self.session_id}")


# ---------------------------------------------------------------------------
# Session manager (singleton — tools import this)
# ---------------------------------------------------------------------------

class SessionManager:
    def __init__(self):
        self._sessions: dict[str, SessionState] = {}

    def get(self, session_id: str) -> Optional[SessionState]:
        return self._sessions.get(session_id)

    def get_active(self) -> Optional[SessionState]:
        # Return the most recently created session that is still active
        for state in reversed(list(self._sessions.values())):
            if state.session_active:
                return state
        return None

    def create(self, session_id: str, websocket: WebSocket) -> SessionState:
        state = SessionState(session_id, websocket)
        self._sessions[session_id] = state
        return state

    def remove(self, session_id: str):
        self._sessions.pop(session_id, None)

    # Proxy methods called by ADK tools ------------------------------------

    async def request_screenshot(
        self, session_id: str, tab_id: str, timeout: float = 5.0
    ) -> Optional[str]:
        state = self.get(session_id)
        if not state:
            return None
        return await state.request_screenshot(session_id, tab_id, timeout)

    async def execute_webmcp(
        self, session_id: str, tab_id: str, tool_name: str, args: dict, timeout: float = 8.0,
    ) -> dict:
        state = self.get(session_id)
        if not state:
            return {"success": False, "error": "Session not found"}
        return await state.execute_webmcp(session_id, tab_id, tool_name, args, timeout)

    async def execute_dom(
        self, session_id: str, tab_id: str, selector: str, action: str, value: Optional[str], timeout: float = 5.0,
    ) -> dict:
        state = self.get(session_id)
        if not state:
            return {"success": False, "error": "Session not found"}
        return await state.execute_dom(session_id, tab_id, selector, action, value, timeout)

    async def get_interactive_elements(
        self, session_id: str, tab_id: str, timeout: float = 5.0,
    ) -> dict:
        state = self.get(session_id)
        if not state:
            return {"success": False, "error": "Session not found"}
        return await state.get_interactive_elements(session_id, tab_id, timeout)


session_manager = SessionManager()


# ---------------------------------------------------------------------------
# Agent -> Client messaging
# ---------------------------------------------------------------------------

async def agent_to_client_messaging(websocket: WebSocket, state: SessionState):
    """Streams ADK live events back to the extension as JSON.
    Includes automatic reconnection on stream errors and an inactivity timeout."""
    await state.initialized_event.wait()
    _session_id = state.session_id
    import websockets.exceptions

    max_reconnects = 3
    reconnect_count = 0
    # Inactivity timeout: if no event arrives for this long, treat stream as dead
    stream_inactivity_timeout = 120.0  # seconds

    while reconnect_count <= max_reconnects and state.session_active:
        try:
            async for event in state.live_events:
                if not state.session_active:
                    break
                
                # Context Management: Prune history after every turn
                if getattr(event, 'turn_complete', False):
                    # Check common history attributes
                    for attr_name in ('history', 'messages', 'events'):
                        hist = getattr(state.adk_session, attr_name, None)
                        if hist is not None and isinstance(hist, list):
                            # Only prune if history exceeds a buffer to reduce overhead
                            if len(hist) > 25:
                                _prune_context(hist, max_turns=20)
                            break

                if getattr(event, 'turn_complete', False) or getattr(event, 'interrupted', False):
                    try:
                        await websocket.send_json({
                            "type": "turn_complete",
                            "interrupted": getattr(event, 'interrupted', False),
                        })
                    except Exception:
                        pass

                # User Input Transcription
                transcription = getattr(event, 'input_transcription', None)
                if transcription and getattr(transcription, 'text', None):
                    transcription_text = transcription.text.strip()
                    if transcription_text and not _is_internal_monologue(transcription_text):
                        is_partial = not getattr(transcription, 'finished', True)
                        
                        # Track finalized input for noise detection
                        if not is_partial:
                            state._last_input_text = transcription_text
                        
                        # Filter noisy user transcripts before sending to UI
                        if _is_transcription_noise(transcription_text):
                            logger.info(f"noise_filter: suppressed user transcript: '{transcription_text}'")
                            continue

                        # PREDICTIVE TRIGGER: Trigger screenshot on first partial word
                        if is_partial:
                            state.trigger_predictive_screenshot()
                            
                        now_iso = datetime.now(timezone.utc).isoformat()
                        logger.info(f"Input transcription{' (partial)' if is_partial else ''}: {transcription_text}")
                        try:
                            await websocket.send_json({
                                "type": "user_transcript",
                                "text": transcription_text,
                                "is_partial": is_partial,
                                "is_non_latin": _has_non_latin(transcription_text),
                                "timestamp": now_iso,
                            })
                        except Exception:
                            pass
                        if not is_partial and state.user_id:
                            asyncio.create_task(
                                firestore_client.append_transcript(
                                    user_id=state.user_id,
                                    session_id=_session_id,
                                    role="user",
                                    text=transcription_text,
                                    timestamp=now_iso,
                                )
                            )

                # Agent Output Transcription
                out_transcription = getattr(event, 'output_transcription', None)
                if out_transcription and getattr(out_transcription, 'text', None):
                    # Suppress agent output if the triggering input was noise
                    if _is_transcription_noise(state._last_input_text):
                        logger.info(f"noise_filter: suppressing agent output (trigger='{state._last_input_text}', output='{out_transcription.text.strip()[:60]}')")
                        continue
                    text = _sanitize_agent_text(out_transcription.text.strip())
                    if text and not _is_internal_monologue(text):
                        is_partial = not getattr(out_transcription, 'finished', True)
                        now_iso = datetime.now(timezone.utc).isoformat()
                        logger.info(f"Output transcription{' (partial)' if is_partial else ''}: {text}")
                        try:
                            await websocket.send_json({
                                "type": "agent_transcript",
                                "text": text,
                                "is_partial": is_partial,
                                "timestamp": now_iso,
                            })
                        except Exception:
                            pass
                        if not is_partial and state.user_id:
                            asyncio.create_task(
                                firestore_client.append_transcript(
                                    user_id=state.user_id,
                                    session_id=_session_id,
                                    role="agent",
                                    text=text,
                                    timestamp=now_iso,
                                )
                            )

                # Content (text/audio from model, or text from user injections)
                if getattr(event, 'content', None) and event.content.parts:
                    role = getattr(event.content, 'role', None)

                    if role == "user":
                        text_parts = "".join(part.text for part in event.content.parts if getattr(part, 'text', None))
                        if text_parts:
                            if ("[SYSTEM CONTEXT" not in text_parts
                                    and "[Page Context]" not in text_parts
                                    and not _is_internal_monologue(text_parts)):
                                is_partial = getattr(event, 'partial', False)
                                now_iso = datetime.now(timezone.utc).isoformat()
                                logger.info(f"Input text injection{' (partial)' if is_partial else ''}: {text_parts}")
                                try:
                                    await websocket.send_json({
                                        "type": "user_transcript",
                                        "text": text_parts.strip(),
                                        "is_partial": is_partial,
                                        "is_non_latin": _has_non_latin(text_parts),
                                        "timestamp": now_iso,
                                    })
                                except Exception:
                                    pass
                                if not is_partial and state.user_id:
                                    asyncio.create_task(
                                        firestore_client.append_transcript(
                                            user_id=state.user_id,
                                            session_id=_session_id,
                                            role="user",
                                            text=text_parts.strip(),
                                            timestamp=now_iso,
                                        )
                                    )
                        
                        # Forward tool results (especially images) to client (Prompt 1)
                        for part in event.content.parts:
                            fr = getattr(part, 'function_response', None)
                            if fr:
                                resp = getattr(fr, 'response', None)
                                if isinstance(resp, dict) and "image_b64" in resp:
                                    try:
                                        logger.info(f"Forwarding image tool result via WS (session={state.session_id})")
                                        # Use shallow copy instead of deepcopy to avoid blocking the event loop (Prompt 1)
                                        # Only copy the top-level keys needed for the frontend
                                        result_to_frontend = {
                                            "image_b64": resp.get("image_b64"),
                                            "mime_type": resp.get("mime_type"),
                                            "caption": resp.get("caption"),
                                            "prompt": resp.get("prompt")
                                        }
                                        await websocket.send_json({
                                            "type": "tool_result",
                                            "tool": "generate_image",
                                            "data": result_to_frontend
                                        })
                                        
                                        # Strip the image data from the version the agent runner sees
                                        resp["image_b64"] = "[IMAGE_DATA_STRIPPED]"
                                        # The modified resp (now without image bytes) is what the runner's internal
                                        # yield logic uses, ensuring context stays lean.
                                    except Exception as e:
                                        logger.error(f"Failed to forward tool result image: {e}")

                    elif role == "model":
                        # Suppress model audio/text output if triggered by noise input
                        if _is_transcription_noise(state._last_input_text):
                            logger.debug(f"noise_filter: suppressing model content (trigger='{state._last_input_text}')")
                            continue
                        for part in event.content.parts:
                            if getattr(part, 'function_call', None):
                                fn_name = part.function_call.name
                                try:
                                    # Check for restricted URL or tab
                                    restricted_prefixes = ["chrome://", "about:", "chrome-extension://", "edge://"]
                                    current_url = state.page_url.lower() if state.page_url else ""
                                    is_chrome_page = any(current_url.startswith(p) for p in restricted_prefixes) or not current_url
                                    is_restricted_tab = any(str(t.get('id')) == str(state.tab_id) for t in state.selected_tabs)
                                    
                                    if fn_name == "generate_image":
                                        await websocket.send_json({"type": "tool_start", "tool": "generate_image"})
                                except Exception as e:
                                    logger.error(f"Failed to send tool status: {e}")

                            if (
                                getattr(part, 'inline_data', None)
                                and part.inline_data.mime_type.startswith("audio/")
                            ):
                                try:
                                    await websocket.send_bytes(part.inline_data.data)
                                except Exception:
                                    pass
                            elif getattr(part, 'text', None):
                                text = _sanitize_agent_text(part.text.strip())
                                if text and not _is_internal_monologue(text):
                                    is_partial = getattr(event, 'partial', False)
                                    logger.info(f"Model text part{' (partial)' if is_partial else ''}: {text}")
                                    # DO NOT send content.parts text via WebSocket or save to Firestore.
                                    # The 'output_transcription' block already captures the spoken text.
                                    # Sending both causes duplicate, concatenated, or garbled histories.
                                    pass
                    else:
                        for part in event.content.parts:
                            if (
                                getattr(part, 'inline_data', None)
                                and part.inline_data.mime_type.startswith("audio/")
                            ):
                                try:
                                    await websocket.send_bytes(part.inline_data.data)
                                except Exception:
                                    pass
                            
                            # Note: Tool results are already handled in the 'user' role block above

            # Stream ended normally (iterator exhausted) — no reconnect needed
            break

        except websockets.exceptions.ConnectionClosedOK:
            logger.info(f"ADK live stream closed normally for session {state.session_id}")
            break
        except Exception as stream_e:
            error_str = str(stream_e)
            if not state.session_active:
                logger.info(f"ADK live stream ended (session inactive): {error_str}")
                break
            reconnect_count += 1
            logger.warning(
                f"ADK live stream error (attempt {reconnect_count}/{max_reconnects}): {error_str}"
            )
            
            # Priority: Graceful Live Failure (429 Quota)
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                logger.error(f"Vertex AI Quota exceeded for live session {state.session_id}")
                try:
                    await websocket.send_json({
                        "type": "status",
                        "message": "Service Busy",
                        "detail": "high_traffic"
                    })
                except Exception:
                    pass
                break # Don't retry if it's a quota error to avoid worsening the situation

            try:
                await websocket.send_json({
                    "type": "status",
                    "level": "warning",
                    "message": "Error 429: Trying to reconnect...",
                    "countdown": 15
                })
            except Exception:
                pass
            if reconnect_count <= max_reconnects:
                backoff = 1.0 * reconnect_count
                logger.info(f"ADK reconnecting in {backoff}s...")
                await asyncio.sleep(backoff)
                try:
                    await state.restart_live_stream()
                    logger.info(f"ADK reconnection {reconnect_count} succeeded for session {state.session_id}")
                    continue
                except Exception as re_err:
                    logger.error(f"ADK reconnection failed: {re_err}")
                    break
            else:
                logger.error(f"ADK max reconnections ({max_reconnects}) reached for session {state.session_id}")
                break

    if not state.session_active:
        return
    # Notify client if stream ended unexpectedly
    if reconnect_count > max_reconnects:
        try:
            await websocket.send_json({
                "type": "status",
                "level": "error",
                "message": "Sorry, please start a new session.",
            })
            # Close connection as requested
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Client -> Agent messaging
# ---------------------------------------------------------------------------

async def client_to_agent_messaging(
    websocket: WebSocket,
    state: SessionState,
):
    """Receives JSON messages from extension, routes them appropriately."""
    while True:
        try:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                logger.info(f"Client disconnected via message type: {state.session_id}")
                break

            # Binary frame = raw PCM audio chunk
            if "bytes" in message:
                decoded_data = message["bytes"]
                if state.live_request_queue and state.session_active:
                    # High-ceiling audio throttle: max 200 chunks per second
                    now = datetime.now(timezone.utc).timestamp()
                    state._audio_throttle_timestamps = [t for t in state._audio_throttle_timestamps if t > now - 1.0]
                    if len(state._audio_throttle_timestamps) > 200:
                        logger.warning(f"Audio throttle active (200/sec) for session={state.session_id}")
                        continue
                    state._audio_throttle_timestamps.append(now)

                    # logger.debug(f"Audio chunk received (binary): {len(decoded_data)} bytes")
                    state.live_request_queue.send_realtime(
                        Blob(data=decoded_data, mime_type="audio/l16;rate=16000")
                    )
                continue

            raw = message.get("text")
            if not raw:
                continue
            message = json.loads(raw)
            msg_type = message.get("type")

            if msg_type == "ping":
                try:
                    await websocket.send_json({"type": "pong"})
                except Exception:
                    pass

            elif msg_type == "auth":
                state.user_id = message.get("user_id", "anonymous")
                state.user_email = message.get("email", "")
                state.user_display_name = message.get("display_name", "")
                state.tab_id = message.get("tab_id")
                state.page_url = message.get("page_url", "")
                state.page_title = message.get("page_title", "")
                # Agent customization settings
                state.agent_voice = message.get("voice", "Aoede")
                state.agent_persona = message.get("persona", "Pilot")
                state.custom_instructions = message.get("custom_instructions", "")
                state.selected_tabs = message.get("selected_tabs", [])
                # Initialize ADK with personalization
                await state.initialize()
                # Upsert user + create session
                asyncio.create_task(
                    firestore_client.upsert_user(
                        user_id=state.user_id,
                        email=state.user_email,
                        display_name=state.user_display_name,
                    )
                )
                asyncio.create_task(
                    firestore_client.create_session(
                        user_id=state.user_id,
                        session_id=state.session_id,
                        page_url=state.page_url,
                        page_title=state.page_title,
                        session_type="live",
                    )
                )
                try:
                    await websocket.send_json(
                        {"type": "status", "level": "info", "message": "Ready to go Live!"}
                    )
                except Exception:
                    pass
                try:
                    await websocket.send_json(
                        {"type": "session_info", "session_id": state.session_id}
                    )
                except Exception:
                    pass

            elif msg_type == "audio_chunk":
                state.tab_id = message.get("tab_id", state.tab_id)
                audio_b64 = message.get("data", "")
                decoded_data = base64.b64decode(audio_b64)
                if state.live_request_queue and state.session_active:
                    state.live_request_queue.send_realtime(
                        Blob(data=decoded_data, mime_type="audio/l16;rate=16000")
                    )

            elif msg_type == "page_context":
                new_url = message.get("url", "")
                old_url = state.page_url
                state.page_url = new_url
                state.page_title = message.get("title", "")
                state.webmcp_available = message.get("webmcp_available", False)
                state.webmcp_tools = message.get("webmcp_tools", [])
                state.selected_tabs = message.get("selected_tabs", state.selected_tabs)
                
                # Only invalidate screenshot cache if the URL actually changed,
                # and delay slightly to let the new page begin rendering
                if new_url != old_url:
                    await asyncio.sleep(0.5)
                    state.cached_screenshot = None
                    state.screenshot_cached_at = 0
                
                logger.info(f"page_context stored: {state.page_url} | {state.page_title}")

            elif msg_type == "screenshot_result":
                success = message.get("success", False)
                error = message.get("error")
                data = message.get("data", "")
                
                if not success:
                    if error in ("chrome_page", "chrome_internal_page"):
                        state.resolve_screenshot("CHROME_INTERNAL_PAGE: Screenshots unavailable here.", success=False)
                    elif error == "tab_restricted":
                        state.resolve_screenshot("TAB_RESTRICTED: This tab is restricted by the user. Screenshots are blocked.", success=False)
                    else:
                        state.resolve_screenshot(error or "unknown_error", success=False)
                else:
                    state.resolve_screenshot(data, success=True)

            elif msg_type == "action_result":
                state.resolve_action(
                    {"success": message.get("success", False), "error": message.get("error")}
                )
                # Invalidate screenshot cache — page may have changed
                state.cached_screenshot = None
                state.screenshot_cached_at = 0

            elif msg_type == "browser_action_result":
                state.resolve_browser(message)
                # Update page state from the browser action result
                if message.get("tabId"):
                    state.tab_id = str(message["tabId"])
                if message.get("url"):
                    state.page_url = message["url"]
                if message.get("title"):
                    state.page_title = message["title"]
                # Invalidate screenshot cache — page may have changed
                state.cached_screenshot = None
                state.screenshot_cached_at = 0

            elif msg_type == "webmcp_tools":
                logger.info(f"webmcp_tools_received count={len(message.get('tools', []))}")

            elif msg_type == "end_session":
                logger.info(f"End session requested: {state.session_id}")
                state.session_active = False
                if state.live_request_queue:
                    state.live_request_queue.close()
                try:
                    await websocket.send_json({"type": "session_ended"})
                except Exception:
                    pass
                break

            elif msg_type == 'file_upload':
                filename = message.get('filename', 'file')
                mime_type = message.get('mime_type', '')
                file_b64 = message.get('data', '')
                size = message.get('size', 0)

                # Store in Firestore (fire and forget)
                asyncio.create_task(
                    firestore_client.store_session_file(
                        user_id=state.user_id,
                        session_id=state.session_id,
                        filename=filename,
                        mime_type=mime_type,
                        data=file_b64,
                    )
                )

                # Send file to agent via live_request_queue
                file_bytes = base64.b64decode(file_b64)

                if mime_type == 'application/pdf' or mime_type.startswith('image/'):
                    # Send as multimodal part
                    if state.live_request_queue:
                        state.live_request_queue.send_realtime(
                            Blob(data=file_bytes, mime_type=mime_type)
                        )
                else:
                    # For text/csv: decode and send as text
                    text_content = file_bytes.decode('utf-8', errors='replace')
                    if state.live_request_queue:
                        from google.genai.types import Content, Part
                        state.live_request_queue.send_content(
                            Content(role='user', parts=[
                                Part(text=f'[User uploaded file: {filename}]\n{text_content}')
                            ])
                        )

                # Confirm to extension
                try:
                    await websocket.send_json({
                        'type': 'file_uploaded',
                        'filename': filename,
                    })
                except Exception:
                    pass
                logger.info(f'file_upload: {filename} ({size} bytes) session={state.session_id}')

            elif msg_type == "document_upload":
                filename = message.get("filename", "unknown.txt")
                content_type = message.get("content_type", "")
                b64_data = message.get("data", "")
                try:
                    raw_bytes = base64.b64decode(b64_data)
                    extracted_text = ""
                    if "pdf" in content_type.lower() or filename.lower().endswith(".pdf"):
                        reader = PdfReader(io.BytesIO(raw_bytes))
                        extracted_text = "\n".join(page.extract_text() for page in reader.pages if page.extract_text())
                    elif "csv" in content_type.lower() or filename.lower().endswith(".csv"):
                        csv_data = raw_bytes.decode("utf-8", errors="ignore")
                        csv_reader = csv.reader(io.StringIO(csv_data))
                        extracted_text = "\n".join(", ".join(row) for row in csv_reader)
                    else:
                        extracted_text = raw_bytes.decode("utf-8", errors="ignore")
                    state.documents[filename] = extracted_text
                    logger.info(f"Document stored: {filename} ({len(extracted_text)} chars)")
                    try:
                        await websocket.send_json({
                            "type": "document_ready",
                            "filename": filename,
                            "char_count": len(extracted_text)
                        })
                    except Exception:
                        pass
                except Exception as doc_err:
                    logger.error(f"Failed to parse document {filename}: {doc_err}")

        except WebSocketDisconnect:
            logger.info(f"Client disconnected: {state.session_id}")
            break
        except Exception as e:
            logger.error(f"client_to_agent_messaging error: {e}")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Axis backend starting")
    yield
    logger.info("Axis backend shutting down")


app = FastAPI(title="Axis", lifespan=lifespan)

# --- Rate Limiter (slowapi) ---
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- WebSocket concurrency limits ---
_MAX_LIVE_WS_CONNECTIONS = 50
_MAX_CHAT_WS_CONNECTIONS = 50
_active_live_ws = 0
_active_chat_ws = 0
_ws_lock = asyncio.Lock()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "axis"}


@app.get("/users/{user_id}/sessions")
async def get_user_sessions(
    user_id: str,
    limit: int = Query(default=10, ge=1, le=50),
):
    """Return recent sessions for a user."""
    sessions = await firestore_client.get_recent_sessions(user_id, limit)
    return sessions


@app.get("/users/{user_id}/sessions/{session_id}/transcript")
async def get_session_transcript(user_id: str, session_id: str):
    """Return full transcript array for a session."""
    transcript = await firestore_client.get_session_transcript(user_id, session_id)
    return transcript


@app.delete("/users/{user_id}/sessions/{session_id}")
async def delete_session(user_id: str, session_id: str):
    """Hard delete a session from Firestore."""
    await firestore_client.delete_session(user_id, session_id)
    return {"success": True}


# ---------------------------------------------------------------------------
# Feedback endpoint
# ---------------------------------------------------------------------------

class FeedbackRequest(BaseModel):
    feedback_type: str
    subject: str
    message: str
    sender_name: str = "Anonymous"
    user_email: str = ""


_feedback_timestamps: dict[str, list[float]] = {}


@app.post("/feedback")
@limiter.limit("5/minute")
async def submit_feedback(payload: FeedbackRequest, request: Request):
    """Send feedback email. Rate limited: max 5 per email per hour."""
    email = payload.user_email
    now = datetime.now(timezone.utc).timestamp()

    # Rate limit per email
    if email:
        timestamps = _feedback_timestamps.get(email, [])
        hour_ago = now - 3600
        timestamps = [t for t in timestamps if t > hour_ago]
        if len(timestamps) >= 3:
            raise HTTPException(
                status_code=429,
                detail="Too many feedback submissions. Try again later.",
            )
        timestamps.append(now)
        _feedback_timestamps[email] = timestamps

    success = await send_feedback_email(
        feedback_type=payload.feedback_type,
        subject=payload.subject,
        message=payload.message,
        sender_name=payload.sender_name,
        user_email=payload.user_email,
    )

    if success:
        return {"success": True}
    return {"success": False, "error": "Failed to send feedback"}


# ---------------------------------------------------------------------------
# Image Generation Endpoint
# ---------------------------------------------------------------------------

class ImageGenRequest(BaseModel):
    prompt: str
    session_id: str = ""

@app.post("/generate-image")
@limiter.limit("10/minute")
async def generate_image_endpoint(payload: ImageGenRequest, request: Request):
    """
    Generate an image using Gemini 2.5 Flash Image.
    Returns base64 encoded image and associated metadata.
    """
    if not payload.prompt:
        raise HTTPException(status_code=400, detail="Prompt is missing")

    logger.info(f"Generating image for session={payload.session_id} | Prompt: {payload.prompt[:60]}...")
    
    # Broadcast tool_start via WebSocket so UI can show the generating bubble immediately
    if payload.session_id:
        state = session_manager.get(payload.session_id)
        if state and state.websocket and state.session_active:
            try:
                await state.websocket.send_json({"type": "tool_start", "tool": "generate_image"})
            except Exception as e:
                logger.debug(f"Failed to send tool_start via WS: {e}")

    def _call_genai():
        return vertex_client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=payload.prompt,
            config=types.GenerateContentConfig(
                response_modalities=[types.Modality.TEXT, types.Modality.IMAGE],
                image_config=types.ImageConfig(
                    aspect_ratio="1:1",
                ),
            ),
        )

    try:
        # Run in executor to avoid blocking the event loop (Prompt 1)
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, _call_genai)

        if not response.candidates or not response.candidates[0].content.parts:
            raise HTTPException(status_code=500, detail="No content generated by model")

        image_b64 = None
        caption = None

        for part in response.candidates[0].content.parts:
            if getattr(part, 'inline_data', None):
                image_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
            elif getattr(part, 'text', None):
                caption = part.text.strip()

        if not image_b64:
            logger.error("No inline_data (image) found in Gemini response parts")
            raise HTTPException(status_code=500, detail="No image data found in response")

        return {
            "image_b64": image_b64,
            "mime_type": "image/png",
            "caption": caption,
            "prompt": payload.prompt
        }

    except Exception as e:
        logger.error(f"Image generation failed: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Chat session endpoints (non-live, text-only)
# ---------------------------------------------------------------------------

class ChatSessionRequest(BaseModel):
    user_id: str
    session_id: str
    page_url: str = ""
    page_title: str = ""
    session_type: str = "chat"
    selected_tabs: list = []


@app.post("/chat-sessions")
@limiter.limit("10/minute")
async def create_chat_session(req: ChatSessionRequest, request: Request):
    """Create a Firestore session doc for a text chat."""
    await firestore_client.create_session(
        user_id=req.user_id,
        session_id=req.session_id,
        page_url=req.page_url,
        page_title=req.page_title,
        session_type=req.session_type,
    )
    return {"ok": True, "session_id": req.session_id}


# ---------------------------------------------------------------------------
# Chat Agent (WebSocket-based with full tool access)
# ---------------------------------------------------------------------------

CHAT_SYSTEM_PROMPT = (
    "[CHAT MODE]\n"
    "You are responding via text chat, not voice. Adjust:\n"
    "- You CAN use basic formatting when helpful.\n"
    "- Keep replies concise (1-3 sentences).\n"
    "- You MUST use your tools to interact with the browser.\n"
    "- When asked about screen content, ALWAYS call screenshot_tool first.\n"
    "- Never claim you cannot see the screen — use screenshot_tool.\n\n"
) + SYSTEM_PROMPT

CHAT_TOOL_DECLARATIONS = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="screenshot_tool",
        description="Takes a screenshot of the active browser tab. Call this when you need to see the current page state. The screenshot image will be provided to you for analysis.",
        parameters=types.Schema(type="OBJECT", properties={}),
    ),
    types.FunctionDeclaration(
        name="execute_dom_action",
        description="Performs a DOM action on the current webpage. Use for clicking, typing, scrolling, hovering on page elements.",
        parameters=types.Schema(
            type="OBJECT",
            properties={
                "action": types.Schema(type="STRING", description="One of: click, type, hover, scroll_down, scroll_up, scroll_to_top, scroll_to_bottom, select, get_interactive_elements"),
                "selector": types.Schema(type="STRING", description="CSS selector for the target element"),
                "value": types.Schema(type="STRING", description="Text to type, scroll amount, or option value"),
            },
            required=["action"],
        ),
    ),
    types.FunctionDeclaration(
        name="browser_action",
        description="Controls browser tabs and navigation. Use to open/close/switch tabs, navigate to URLs, go back/forward, or refresh.",
        parameters=types.Schema(
            type="OBJECT",
            properties={
                "action": types.Schema(type="STRING", description="One of: open_tab, close_tab, switch_tab, navigate, go_back, go_forward, refresh"),
                "url": types.Schema(type="STRING", description="URL for open_tab or navigate"),
                "tab_query": types.Schema(type="STRING", description="Partial title or URL for switch_tab"),
            },
            required=["action"],
        ),
    ),
    types.FunctionDeclaration(
        name="generate_image",
        description="Generate an image from a text description and return it to the user. Use this when the user asks to draw, create, generate, or visualise something.",
        parameters=types.Schema(
            type="OBJECT",
            properties={
                "prompt": types.Schema(type="STRING", description="A detailed text description of the image to generate."),
            },
            required=["prompt"],
        ),
    ),
])


async def _execute_chat_tool(state: SessionState, tool_name: str, args: dict) -> tuple:
    """Execute a tool from the chat agent. Returns (result_dict, optional_image_bytes)."""
    try:
        if tool_name == "screenshot_tool":
            jpeg_b64 = await state.request_screenshot(
                state.session_id, state.tab_id or "", timeout=8.0
            )
            if not jpeg_b64:
                return {"success": False, "error": "Screenshot capture failed or timed out"}, None
            if isinstance(jpeg_b64, str) and jpeg_b64.startswith("CHROME_INTERNAL"):
                return {"success": False, "error": "Cannot screenshot Chrome internal pages. Ask user to navigate to a website."}, None
            if isinstance(jpeg_b64, str) and jpeg_b64 == "TAB_RESTRICTED":
                return {"success": False, "error": "This tab is restricted by the user. Screenshots are blocked. Ask the user to switch to a different tab or remove the restriction."}, None
            image_bytes = base64.b64decode(jpeg_b64)
            return {"success": True, "message": "Screenshot captured. Analyze the page contents."}, image_bytes

        elif tool_name == "execute_dom_action":
            action = args.get("action", "")
            selector = args.get("selector")
            value = args.get("value")
            if action == "get_interactive_elements":
                result = await state.get_interactive_elements(
                    state.session_id, state.tab_id or "", timeout=5.0
                )
                return result, None
            result = await state.execute_dom(
                state.session_id, state.tab_id or "",
                selector=selector or "body", action=action, value=value, timeout=5.0,
            )
            return result, None

        elif tool_name == "browser_action":
            action = args.get("action", "")
            url = args.get("url")
            tab_query = args.get("tab_query")
            if action == "open_tab" and not url:
                url = "chrome://newtab/"
            if action == "navigate" and not url:
                return {"success": False, "error": "'navigate' requires a url"}, None
            if action == "switch_tab" and not tab_query:
                return {"success": False, "error": "'switch_tab' requires a tab_query"}, None
            state._browser_future = asyncio.get_event_loop().create_future()
            await state.websocket.send_json({
                "type": "browser_action", "action": action, "url": url, "tab_query": tab_query,
            })
            try:
                result = await asyncio.wait_for(state._browser_future, timeout=5.0)
            except asyncio.TimeoutError:
                return {"success": False, "error": "Browser action timed out"}, None
            finally:
                state._browser_future = None
            if action in ("navigate", "go_back", "go_forward", "refresh"):
                await asyncio.sleep(1.0)
            return result, None

        elif tool_name == "generate_image":
            prompt = args.get("prompt", "")
            if not prompt:
                return {"success": False, "error": "'generate_image' requires a prompt"}, None
            # Send tool_start to UI for generating bubble
            try:
                await state.websocket.send_json({"type": "tool_start", "tool": "generate_image"})
            except Exception:
                pass
            # Call the REST endpoint
            import httpx
            async with httpx.AsyncClient(timeout=60.0) as client:
                try:
                    resp = await client.post("http://localhost:8080/generate-image", json={"prompt": prompt, "session_id": state.session_id})
                    resp.raise_for_status()
                    result = resp.json()
                    return result, None
                except Exception as e:
                    logger.error(f"Chat generate_image error: {e}")
                    return {"success": False, "error": str(e)}, None

        else:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}, None
    except Exception as e:
        logger.error(f"_execute_chat_tool error: {e}")
        return {"success": False, "error": str(e)}, None


async def _run_chat_agent(state: SessionState, user_message: str) -> str:
    """Run the chat agent with function calling. Returns final text reply."""
    try:
        client = genai.Client(
            vertexai=True,
            project=settings.google_cloud_project,
            location=settings.google_cloud_location,
        )

        # Auto-screenshot: capture the screen before processing user text
        auto_screenshot_bytes = None
        try:
            jpeg_b64 = await state.request_screenshot(
                state.session_id, state.tab_id or "", timeout=8.0
            )
            if jpeg_b64 and isinstance(jpeg_b64, str) and not jpeg_b64.startswith("CHROME_INTERNAL"):
                auto_screenshot_bytes = base64.b64decode(jpeg_b64)
        except Exception as e:
            logger.warning(f"Auto-screenshot failed: {e}")

        # Build user content with page context
        user_parts = []
        if state.page_url:
            user_parts.append(types.Part.from_text(text=
                f"[Current page: {state.page_title} — {state.page_url}]"
            ))
        if auto_screenshot_bytes:
            user_parts.append(types.Part.from_bytes(data=auto_screenshot_bytes, mime_type="image/jpeg"))
            user_parts.append(types.Part.from_text(text="[Auto-screenshot of current screen attached above]"))
        user_parts.append(types.Part.from_text(text=user_message))
        state.chat_history.append(types.Content(role="user", parts=user_parts))

        # Context Management: Prune before generating
        _prune_context(state.chat_history, max_turns=20)

        for _ in range(10):  # max tool rounds
            # Implement retry for chat generation (Prompt 3)
            response = None
            max_api_retries = 3
            for attempt in range(max_api_retries):
                try:
                    response = client.models.generate_content(
                        model="gemini-2.5-flash",
                        contents=state.chat_history,
                        config=types.GenerateContentConfig(
                            system_instruction=CHAT_SYSTEM_PROMPT,
                            tools=[CHAT_TOOL_DECLARATIONS],
                        ),
                    )
                    break # Success
                except APIError as api_err:
                    if api_err.status_code == 429 and attempt < max_api_retries - 1:
                        logger.warning(f"Quota exceeded (429), retrying in 5s... (Attempt {attempt+1}/{max_api_retries})")
                        # Send status update (Prompt 1)
                        try:
                            await state.websocket.send_json({
                                "type": "status",
                                "level": "warning",
                                "message": "Rate limit hit",
                                "retry_attempt": attempt + 1,
                                "total_attempts": max_api_retries,
                                "countdown": 5
                            })
                        except Exception:
                            pass
                        await asyncio.sleep(5)
                        continue
                    
                    # Last attempt or different error
                    if api_err.status_code == 429:
                         try:
                            await state.websocket.send_json({
                                "type": "status",
                                "level": "error",
                                "message": "Quota exceeded. Please start a new session."
                            })
                         except Exception:
                             pass
                    
                    logger.error(f"Chat generation final error: {api_err}")
                    await state.websocket.send_json({
                        "type": "chat_response", 
                        "text": "Error 429: Please try again later."
                    })
                    return "AI service busy."
                except Exception as e:
                    logger.error(f"Unexpected chat generation error: {e}")
                    raise e

            if not response or not response.candidates:
                return "Sorry, I couldn't generate a response."

            model_content = response.candidates[0].content
            state.chat_history.append(model_content)

            # Check for function calls
            function_calls = [p for p in model_content.parts if p.function_call]
            if not function_calls:
                text = "".join(
                    p.text for p in model_content.parts if getattr(p, 'text', None)
                )
                return text.strip() or "Done."

            # Execute each tool call
            response_parts = []
            pending_images = []
            for fc_part in function_calls:
                fc = fc_part.function_call
                result, image_bytes = await _execute_chat_tool(
                    state, fc.name, dict(fc.args) if fc.args else {}
                )
                response_parts.append(
                    types.Part.from_function_response(name=fc.name, response=result)
                )
                if image_bytes:
                    pending_images.append(image_bytes)

                # Forward to client if it's an image result (Prompt 1)
                if isinstance(result, dict) and "image_b64" in result:
                    try:
                        logger.info(f"Forwarding image to chat client via WS (session={state.session_id})")
                        # Deep copy for frontend so we can strip agent's copy (Prompt 2)
                        result_to_frontend = copy.deepcopy(result)
                        await state.websocket.send_json({
                            "type": "tool_result",
                            "tool": "generate_image",
                            "data": result_to_frontend
                        })

                        # Strip image data before it hits agent history (Prompt 2)
                        result["image_b64"] = "[IMAGE_DATA_STRIPPED]"
                    except Exception as e:
                        logger.error(f"Chat WS image forward error: {e}")

            # Add function responses to history
            state.chat_history.append(types.Content(role="user", parts=response_parts))

            # Add screenshot images as separate content (if any)
            if pending_images:
                image_parts = [
                    types.Part.from_bytes(data=img, mime_type="image/jpeg")
                    for img in pending_images
                ]
                state.chat_history.append(
                    types.Content(role="user", parts=image_parts)
                )

        return "I completed the requested actions."

    except Exception as e:
        logger.error(f"_run_chat_agent error: {e}")
        return f"Sorry, something went wrong. Please try again."


async def _chat_ws_reader(websocket: WebSocket, state: SessionState):
    """Read chat WebSocket messages, route tool results, queue chat messages."""
    while True:
        message = await websocket.receive()
        if message.get("type") == "websocket.disconnect":
            break

        raw = message.get("text")
        if not raw:
            continue
        data = json.loads(raw)
        msg_type = data.get("type")

        if msg_type == "ping":
            try:
                await websocket.send_json({"type": "pong"})
            except Exception:
                pass

        elif msg_type == "auth":
            state.user_id = data.get("user_id", "anonymous")
            state.user_email = data.get("email", "")
            state.user_display_name = data.get("display_name", "")
            state.tab_id = data.get("tab_id")
            state.page_url = data.get("page_url", "")
            state.page_title = data.get("page_title", "")
            asyncio.create_task(
                firestore_client.upsert_user(
                    user_id=state.user_id,
                    email=state.user_email,
                    display_name=state.user_display_name,
                )
            )
            asyncio.create_task(
                firestore_client.create_session(
                    user_id=state.user_id,
                    session_id=state.session_id,
                    page_url=state.page_url,
                    page_title=state.page_title,
                    session_type="chat",
                )
            )
            try:
                await websocket.send_json({"type": "status", "message": "authenticated"})
            except Exception:
                pass

        elif msg_type == "chat_message":
            # Chat throttle: 60 messages per minute (1 per second)
            now = datetime.now(timezone.utc).timestamp()
            state._chat_throttle_timestamps = [t for t in state._chat_throttle_timestamps if t > now - 60.0]
            if len(state._chat_throttle_timestamps) >= 60:
                logger.warning(f"Chat message throttled (60/min) for session={state.session_id}")
                try:
                    await websocket.send_json({
                        "type": "chat_response", 
                        "text": "Slow down! You're sending messages too fast (limit: 60/min)."
                    })
                except Exception:
                    pass
                continue
            state._chat_throttle_timestamps.append(now)
            await state._chat_message_queue.put(data.get("text", ""))

        elif msg_type == "screenshot_result":
            error = data.get("error")
            if error == "chrome_page":
                state.resolve_screenshot("CHROME_INTERNAL_PAGE")
            elif error == "tab_restricted":
                state.resolve_screenshot("TAB_RESTRICTED")
            else:
                state.resolve_screenshot(data.get("data", ""))

        elif msg_type == "action_result":
            state.resolve_action(
                {"success": data.get("success", False), "error": data.get("error"),
                 "elements": data.get("elements")}
            )
            state.cached_screenshot = None
            state.screenshot_cached_at = 0

        elif msg_type == "browser_action_result":
            state.resolve_browser(data)
            if data.get("tabId"):
                state.tab_id = str(data["tabId"])
            if data.get("url"):
                state.page_url = data["url"]
            if data.get("title"):
                state.page_title = data["title"]
            state.cached_screenshot = None
            state.screenshot_cached_at = 0

        elif msg_type == "page_context":
            new_url = data.get("url", "")
            old_url = state.page_url
            state.page_url = new_url
            state.page_title = data.get("title", "")
            state.webmcp_available = data.get("webmcp_available", False)
            state.webmcp_tools = data.get("webmcp_tools", [])
            if new_url != old_url:
                await asyncio.sleep(0.5)
                state.cached_screenshot = None
                state.screenshot_cached_at = 0

        elif msg_type == "end_session":
            state.session_active = False
            try:
                await websocket.send_json({"type": "session_ended"})
            except Exception:
                pass
            break

        elif msg_type == "file_upload":
            filename = data.get("filename", "file")
            file_b64 = data.get("data", "")
            mime_type = data.get("mime_type", "")
            if state.user_id:
                asyncio.create_task(
                    firestore_client.store_session_file(
                        user_id=state.user_id,
                        session_id=state.session_id,
                        filename=filename,
                        mime_type=mime_type,
                        data=file_b64,
                    )
                )
            state.documents[filename] = f"[Binary file: {filename}, type: {mime_type}]"


async def _chat_message_processor(websocket: WebSocket, state: SessionState):
    """Process queued chat messages through the agent loop."""
    while state.session_active:
        text = await state._chat_message_queue.get()
        if not text:
            continue
        try:
            await websocket.send_json({"type": "chat_thinking"})
            reply = await _run_chat_agent(state, text)
            await websocket.send_json({"type": "chat_response", "text": reply})
            now = datetime.now(timezone.utc).isoformat()
            if state.user_id:
                asyncio.create_task(
                    firestore_client.append_transcript(
                        state.user_id, state.session_id, "user", text, now
                    )
                )
                asyncio.create_task(
                    firestore_client.append_transcript(
                        state.user_id, state.session_id, "agent", reply, now
                    )
                )
        except Exception as e:
            logger.error(f"Chat message processing error: {e}")
            try:
                await websocket.send_json(
                    {"type": "chat_response", "text": "Sorry, something went wrong."}
                )
            except Exception:
                pass


@app.websocket("/ws-chat/{session_id}")
async def ws_chat_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for text chat with full tool access."""
    global _active_chat_ws
    async with _ws_lock:
        if _active_chat_ws >= _MAX_CHAT_WS_CONNECTIONS:
            await websocket.close(code=1013, reason="Server busy — too many chat connections")
            logger.warning(f"Chat WS rejected (concurrency limit): {session_id}")
            return
        _active_chat_ws += 1
    try:
        await _ws_chat_endpoint_inner(websocket, session_id)
    finally:
        async with _ws_lock:
            _active_chat_ws -= 1


async def _ws_chat_endpoint_inner(websocket: WebSocket, session_id: str):
    await websocket.accept()
    state = session_manager.create(session_id, websocket)
    state._chat_message_queue = asyncio.Queue()

    logger.info(f"Chat WebSocket connected: {session_id}")
    try:
        await websocket.send_json({"type": "ready"})
    except Exception:
        pass

    reader_task = None
    processor_task = None
    try:
        reader_task = asyncio.create_task(_chat_ws_reader(websocket, state))
        processor_task = asyncio.create_task(_chat_message_processor(websocket, state))
        await asyncio.wait(
            [reader_task, processor_task], return_when=asyncio.FIRST_EXCEPTION
        )
    except WebSocketDisconnect:
        logger.info(f"Chat WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"Chat WebSocket error: {e}")
    finally:
        state.close()
        for task in [reader_task, processor_task]:
            if task and not task.done():
                task.cancel()
        await asyncio.gather(
            *[t for t in [reader_task, processor_task] if t],
            return_exceptions=True,
        )
        if state.user_id:
            try:
                transcript = await firestore_client.get_session_transcript(
                    state.user_id, session_id
                )
                headline = await _generate_session_headline(transcript)
                asyncio.create_task(
                    firestore_client.end_session(state.user_id, session_id, headline)
                )
            except Exception:
                asyncio.create_task(
                    firestore_client.end_session(
                        state.user_id, session_id, "Chat session"
                    )
                )
        session_manager.remove(session_id)


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    global _active_live_ws
    async with _ws_lock:
        if _active_live_ws >= _MAX_LIVE_WS_CONNECTIONS:
            await websocket.close(code=1013, reason="Server busy — too many live connections")
            logger.warning(f"Live WS rejected (concurrency limit): {session_id}")
            return
        _active_live_ws += 1
    try:
        await _ws_live_endpoint_inner(websocket, session_id)
    finally:
        async with _ws_lock:
            _active_live_ws -= 1


async def _ws_live_endpoint_inner(websocket: WebSocket, session_id: str):
    await websocket.accept()
    state = session_manager.create(session_id, websocket)
    # Don't initialize yet — wait for auth message with voice/persona settings

    logger.info(f"WebSocket connected: {session_id}")

    # Signal to extension that backend is ready for auth
    try:
        await websocket.send_json({"type": "ready"})
    except Exception:
        pass

    agent_to_client_task = None
    client_to_agent_task = None
    try:
        agent_to_client_task = asyncio.create_task(
            agent_to_client_messaging(websocket, state)
        )
        client_to_agent_task = asyncio.create_task(
            client_to_agent_messaging(websocket, state)
        )
        tasks = [agent_to_client_task, client_to_agent_task]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        state.close()
        # Cancel both tasks
        for task in [agent_to_client_task, client_to_agent_task]:
            if task and not task.done():
                task.cancel()
        await asyncio.gather(
            *[t for t in [agent_to_client_task, client_to_agent_task] if t],
            return_exceptions=True,
        )
        # Generate headline and end session
        if state.user_id:
            try:
                transcript = await firestore_client.get_session_transcript(
                    state.user_id, session_id
                )
                headline = await _generate_session_headline(transcript)
                asyncio.create_task(
                    firestore_client.end_session(state.user_id, session_id, headline)
                )
            except Exception as e:
                logger.error(f"Session end headline error: {e}")
                asyncio.create_task(
                    firestore_client.end_session(state.user_id, session_id, "Browser session")
                )
        session_manager.remove(session_id)
