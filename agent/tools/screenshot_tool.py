"""agent/tools/screenshot_tool.py
Captures the current browser tab screenshot and sends it to the live agent.
"""
import asyncio
import base64
import logging

logger = logging.getLogger(__name__)

# Retry config for screenshot capture
_SCREENSHOT_MAX_RETRIES = 3
_SCREENSHOT_BACKOFF_MS = [200, 500, 800]  # Increased backoff for better render waiting


async def screenshot_tool() -> dict:
    """
    Takes a screenshot of the active browser tab and sends it to you for analysis.
    Call this when you need to see the current page state.
    The screenshot image will appear in your context — describe what you see.
    """
    try:
        from backend.main import session_manager

        state = session_manager.get_active()
        if not state:
            return {"success": False, "error": "No active browser session"}

        # Priority 3: Check for restricted URLs (chrome://, about:, etc.) and restricted tabs
        restricted_prefixes = ["chrome://", "about:", "chrome-extension://", "edge://"]
        current_url = state.page_url.lower() if state.page_url else ""
        is_chrome_page = any(current_url.startswith(p) for p in restricted_prefixes) or not current_url
        is_restricted_tab = any(str(t.get('id')) == str(state.tab_id) for t in state.selected_tabs)
        
        if is_chrome_page or is_restricted_tab:
            logger.info(f"[screenshot] Restricted view detected (chrome={is_chrome_page}, tab={is_restricted_tab}). Returning gray fallback.")
            # 1x1 Gray PNG pixel base64
            gray_pixel_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
            
            # Inject fallback into live stream
            from google.genai.types import Blob
            if state.live_request_queue:
                image_bytes = base64.b64decode(gray_pixel_b64)
                state.live_request_queue.send_realtime(
                    Blob(data=image_bytes, mime_type="image/png")
                )
            
            return {
                "success": True,
                "page_url": state.page_url or "Restricted",
                "page_title": state.page_title or "Restricted",
                "message": "This is a restricted browser page or a restricted tab. A placeholder image has been used. Please ask the user to navigate to a public website if you need to see content."
            }

        # Retry screenshot capture with exponential backoff
        jpeg_b64 = None
        last_error = "Screenshot capture timed out"
        for attempt in range(_SCREENSHOT_MAX_RETRIES):
            try:
                jpeg_b64 = await state.request_screenshot(
                    state.session_id, state.tab_id or "", timeout=8.0
                )
                if jpeg_b64:
                    if attempt > 0:
                        logger.info(f"[screenshot] Succeeded on retry attempt {attempt + 1}/{_SCREENSHOT_MAX_RETRIES}")
                    break

                last_error = "Screenshot capture returned empty"
                logger.warning(
                    f"[screenshot] Attempt {attempt + 1}/{_SCREENSHOT_MAX_RETRIES} failed: empty result"
                )
            except Exception as capture_err:
                last_error = str(capture_err)
                logger.warning(
                    f"[screenshot] Attempt {attempt + 1}/{_SCREENSHOT_MAX_RETRIES} exception: {capture_err}"
                )

            if attempt < _SCREENSHOT_MAX_RETRIES - 1:
                backoff_ms = _SCREENSHOT_BACKOFF_MS[attempt]
                logger.info(f"[screenshot] Retrying in {backoff_ms}ms...")
                await asyncio.sleep(backoff_ms / 1000)

        if not jpeg_b64:
            logger.error(f"[screenshot] All {_SCREENSHOT_MAX_RETRIES} attempts failed: {last_error}")
            return {"success": False, "error": last_error}

        # Inject screenshot into the live stream so the agent can see it directly
        from google.genai.types import Blob
        if state.live_request_queue:
            image_bytes = base64.b64decode(jpeg_b64)
            try:
                state.live_request_queue.send_realtime(
                    Blob(data=image_bytes, mime_type="image/jpeg")
                )
            except Exception as e:
                return {"success": False, "error": "WebSocket closed"}

        # Optional: Inject document context
        doc_context = ""
        if state.documents:
            doc_context = "\\n\\n--- UPLOADED DOCUMENTS ---\\n"
            for label, content in state.documents.items():
                doc_context += f"\\n[DOCUMENT: {label}]\\n{content}\\n[/DOCUMENT]\\n"

        logger.info(f"screenshot_sent_to_live_stream url={state.page_url}")
        return {
            "success": True,
            "page_url": state.page_url,
            "page_title": state.page_title,
            "webmcp_available": state.webmcp_available,
            "message": f"Screenshot captured and visible in your context. Describe what you see, then act on the user's request.{doc_context}",
        }

    except Exception as e:
        logger.error(f"screenshot_tool error: {e}")
        return {"success": False, "error": str(e)}
