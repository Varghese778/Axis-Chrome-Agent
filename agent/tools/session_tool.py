"""
agent/tools/session_tool.py
Logs session events locally (no Firestore dependency).
"""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


async def log_session_event(
    event_type: str,
    user_intent: str = "",
) -> dict:
    """
    Logs an action event to the session audit trail.
    Call this after every action execution (success or failure).
    event_type: one of voice_command, action_executed, error
    user_intent: brief description of what was done
    """
    try:
        from backend.main import session_manager

        state = session_manager.get_active()
        session_id = state.session_id if state else "unknown"

        now = datetime.now(timezone.utc)
        logger.info(f"session_event: type={event_type} intent={user_intent} session={session_id} ts={now.isoformat()}")

        return {
            "success": True,
            "event_id": f"{session_id}_{now.timestamp()}",
        }
    except Exception as e:
        logger.error(f"log_session_event error: {e}")
        return {"success": False, "error": str(e)}


async def end_session_tool() -> dict:
    """
    End the current live session and return to the home screen.
    Use this when the user says 'end session', 'stop the session', or similar.
    """
    try:
        from backend.main import session_manager
        state = session_manager.get_active()
        if not state:
            return {"success": False, "error": "No active session"}

        result = await state.execute_webmcp(
            session_id=state.session_id,
            tab_id=state.tab_id or "",
            tool_name="end_session",
            args={},
            timeout=5.0,
        )
        return result
    except Exception as e:
        logger.error(f"end_session_tool error: {e}")
        return {"success": False, "error": str(e)}


async def hold_session_tool() -> dict:
    """
    Pause or put the current live session on hold. This stops the microphone.
    Use this when the user says 'pause', 'hold session', 'stop listening', or similar.
    """
    try:
        from backend.main import session_manager
        state = session_manager.get_active()
        if not state:
            return {"success": False, "error": "No active session"}

        result = await state.execute_webmcp(
            session_id=state.session_id,
            tab_id=state.tab_id or "",
            tool_name="hold_session",
            args={},
            timeout=5.0,
        )
        return result
    except Exception as e:
        logger.error(f"hold_session_tool error: {e}")
        return {"success": False, "error": str(e)}


async def resume_session_tool() -> dict:
    """
    Resume the live session from hold. This re-activates the microphone.
    Use this when the user says 'resume', 'start listening again', or similar.
    """
    try:
        from backend.main import session_manager
        state = session_manager.get_active()
        if not state:
            return {"success": False, "error": "No active session"}

        result = await state.execute_webmcp(
            session_id=state.session_id,
            tab_id=state.tab_id or "",
            tool_name="resume_session",
            args={},
            timeout=5.0,
        )
        return result
    except Exception as e:
        logger.error(f"resume_session_tool error: {e}")
        return {"success": False, "error": str(e)}
