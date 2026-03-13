"""
agent/tools/dom_action_tool.py
Fallback DOM interaction tool using CSS selectors.
"""
import asyncio
import logging
from typing import Optional

from agent.models.schemas import ActionResult

logger = logging.getLogger(__name__)

# Max retries for click actions when element is not visible
_CLICK_MAX_RETRIES = 3
_CLICK_RETRY_DELAY_MS = 200


async def execute_dom_action(
    action: str,
    selector: Optional[str] = None,
    value: Optional[str] = None,
    user_intent: str = "",
) -> dict:
    """
    Performs a DOM action on the current webpage.
    Use this as fallback when WebMCP tools are not available.
    action: one of 'click', 'type', 'hover', 'scroll', 'scroll_down', 'scroll_up', 'scroll_to_top', 'scroll_to_bottom', 'select', 'get_interactive_elements'
    selector: CSS selector for the target element (not needed for scroll_down/scroll_up/scroll_to_top/scroll_to_bottom/get_interactive_elements)
    value: text to type (if action=type), scroll pixels (if action=scroll_down/scroll_up), or option value (if action=select)
    user_intent: plain English description of the user's goal
    NOTE: For type/click actions, fallback selectors are tried automatically if the given selector fails. On failure, the tool returns a list of actual interactive elements found on the page — use one of their selectors to retry.
    """
    try:
        from backend.main import session_manager

        state = session_manager.get_active()
        if not state:
            return ActionResult(
                success=False, mode_used="dom", error="No active session",
                response_text="No active browser session found.",
            ).model_dump()

        # Special action: discover interactive elements on the page
        if action == "get_interactive_elements":
            result = await state.get_interactive_elements(
                session_id=state.session_id,
                tab_id=state.tab_id or "",
                timeout=5.0,
            )
            return ActionResult(
                success=result.get("success", False),
                mode_used="dom",
                error=result.get("error"),
                response_text=str(result.get("elements", [])),
            ).model_dump()

        effective_selector = selector or "body"
        logger.info(f"dom_action: BEFORE action={action} selector='{effective_selector}' intent='{user_intent}'")

        # For click actions, retry up to 3 times to handle elements that are
        # still loading or not yet visible.
        if action == "click":
            result = await _execute_click_with_visibility_retry(
                state, effective_selector, value, timeout=5.0,
            )
        else:
            result = await state.execute_dom(
                session_id=state.session_id,
                tab_id=state.tab_id or "",
                selector=effective_selector,
                action=action,
                value=value,
                timeout=5.0,
            )

        # For scroll actions, verify the scroll succeeded
        if action in ("scroll_to_top", "scroll_to_bottom", "scroll_up", "scroll_down"):
            scroll_y = result.get("scrollY")
            scroll_height = result.get("scrollHeight")
            if result.get("success"):
                if action == "scroll_to_top" and scroll_y is not None and scroll_y > 10:
                    logger.warning(f"dom_action: scroll_to_top may have failed — scrollY={scroll_y}")
                elif action == "scroll_to_bottom" and scroll_y is not None and scroll_height is not None:
                    if scroll_y + 50 < scroll_height:
                        logger.warning(f"dom_action: scroll_to_bottom may not have reached end — scrollY={scroll_y} scrollHeight={scroll_height}")

        if result.get("success"):
            used_selector = result.get("usedSelector", effective_selector)
            msg = f"Done — {user_intent}."
            if action == 'click':
                msg += " Hint: If this click triggers navigation or a layout change, please take a fresh screenshot or wait 2-3 seconds for the page to settle before your next action."
            
            action_result = ActionResult(
                success=True,
                mode_used="dom",
                error=None,
                response_text=msg,
            )
            if used_selector != effective_selector:
                logger.info(f"dom_action: selector fallback used: '{effective_selector}' -> '{used_selector}'")
        else:
            # On failure, fetch interactive elements to help the agent self-correct
            hints = ""
            try:
                elems = await state.get_interactive_elements(
                    session_id=state.session_id,
                    tab_id=state.tab_id or "",
                    timeout=3.0,
                )
                if elems.get("success") and elems.get("elements"):
                    items = elems["elements"][:8]  # top 8
                    hints = " Available interactive elements: " + ", ".join(
                        f'{e.get("selector","")} ({e.get("tag","")}, placeholder={e.get("placeholder","")})' for e in items
                    )
            except Exception:
                pass

            action_result = ActionResult(
                success=False,
                mode_used="dom",
                error=result.get("error"),
                response_text=f"Element not found with selector '{selector}'.{hints} Take a fresh screenshot and try again with one of these selectors.",
            )

        logger.info(
            f"dom_action: AFTER action={action} selector='{effective_selector}' success={action_result.success}"
            + (f" error={action_result.error}" if not action_result.success else ""),
        )
        return action_result.model_dump()

    except Exception as e:
        logger.error(f"execute_dom_action error: {e}")
        return ActionResult(
            success=False,
            mode_used="dom",
            error=str(e),
            response_text="I had trouble with that action. Please try again.",
        ).model_dump()


async def _execute_click_with_visibility_retry(
    state, selector: str, value: Optional[str], timeout: float = 5.0,
) -> dict:
    """Attempt a click, retrying up to 3 times if the element is not visible."""
    for attempt in range(1, _CLICK_MAX_RETRIES + 1):
        result = await state.execute_dom(
            session_id=state.session_id,
            tab_id=state.tab_id or "",
            selector=selector,
            action="click",
            value=value,
            timeout=timeout,
        )
        if result.get("success"):
            return result

        error_msg = result.get("error", "")
        # If element exists but is not visible, retry after a short delay
        if "not visible" in error_msg.lower() and attempt < _CLICK_MAX_RETRIES:
            logger.info(f"dom_action: click attempt {attempt}/{_CLICK_MAX_RETRIES} — element not visible, retrying in {_CLICK_RETRY_DELAY_MS}ms")
            await asyncio.sleep(_CLICK_RETRY_DELAY_MS / 1000)
            continue
        # Element not found or other error — no point retrying
        break
    return result
