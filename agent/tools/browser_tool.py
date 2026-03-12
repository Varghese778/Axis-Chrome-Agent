"""
agent/tools/browser_tool.py
Browser navigation tool — open, close, switch tabs; navigate URLs.
"""
import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def browser_action(
    action: str,
    url: Optional[str] = None,
    tab_query: Optional[str] = None,
) -> dict:
    """
    Controls browser tabs and navigation. Use this to open new tabs, close tabs,
    switch between tabs, navigate to a URL, go back/forward, or refresh the page.

    action: one of 'open_tab', 'close_tab', 'switch_tab', 'navigate', 'go_back', 'go_forward', 'refresh', 'list_tabs'
    url: URL to open or navigate to (required for open_tab and navigate)
    tab_query: partial title or URL to match when switching tabs (required for switch_tab)
    """
    try:
        from backend.main import session_manager

        state = session_manager.get_active()
        if not state:
            return {"success": False, "error": "No active browser session"}

        valid_actions = [
            "open_tab", "close_tab", "switch_tab",
            "navigate", "go_back", "go_forward", "refresh", "list_tabs",
        ]
        if action not in valid_actions:
            return {"success": False, "error": f"Unknown action '{action}'. Use one of: {', '.join(valid_actions)}"}

        if action == "open_tab" and not url:
            url = "chrome://newtab/"

        if action == "navigate" and not url:
            return {"success": False, "error": "'navigate' requires a url parameter"}

        if action == "switch_tab" and not tab_query:
            return {"success": False, "error": "'switch_tab' requires a tab_query parameter (partial title or URL)"}

        # Send browser action request to extension via WebSocket
        state._browser_future = asyncio.get_event_loop().create_future()
        await state.websocket.send_json({
            "type": "browser_action",
            "action": action,
            "url": url,
            "tab_query": tab_query,
        })

        try:
            result = await asyncio.wait_for(state._browser_future, timeout=5.0)
        except asyncio.TimeoutError:
            return {"success": False, "error": "Browser action timed out"}
        finally:
            state._browser_future = None

        # Wait for content script to be ready after navigation actions
        if action in ("navigate", "go_back", "go_forward", "refresh"):
            await asyncio.sleep(1.0)

        logger.info(f"browser_action: {action} -> {result.get('success')}")
        return result

    except Exception as e:
        logger.error(f"browser_action error: {e}")
        return {"success": False, "error": str(e)}
