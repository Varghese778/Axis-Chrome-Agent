"""
agent/tools/webmcp_tool.py
Executes WebMCP tool calls via the Chrome extension content script.
"""
import logging

from agent.models.schemas import ActionResult

logger = logging.getLogger(__name__)


async def execute_webmcp_tool(
    tool_name: str,
    tool_args: dict,
    user_intent: str,
) -> dict:
    """
    Executes a WebMCP tool on the current webpage.
    Use this when screenshot analysis shows webmcp_available=true and a relevant tool exists.
    tool_name: the exact name of the WebMCP tool to call
    tool_args: arguments matching the tool's input schema
    user_intent: plain English description of what the user wants
    """
    try:
        from backend.main import session_manager

        state = session_manager.get_active()
        if not state:
            return ActionResult(
                success=False, mode_used="webmcp", tool_name=tool_name,
                error="No active session",
                response_text="No active browser session found.",
            ).model_dump()

        result = await state.execute_webmcp(
            session_id=state.session_id,
            tab_id=state.tab_id or "",
            tool_name=tool_name,
            args=tool_args,
            timeout=8.0,
        )

        action_result = ActionResult(
            success=result.get("success", False),
            mode_used="webmcp",
            tool_name=tool_name,
            error=result.get("error"),
            response_text=(
                f"Done — used {tool_name} to {user_intent}."
                if result.get("success")
                else f"The {tool_name} tool failed. Trying another way."
            ),
        )

        logger.info(
            "webmcp_executed",
            extra={
                "session_id": session_id,
                "tool": tool_name,
                "success": action_result.success,
            },
        )
        return action_result.model_dump()

    except Exception as e:
        logger.error(f"execute_webmcp_tool error: {e}")
        return ActionResult(
            success=False,
            mode_used="webmcp",
            tool_name=tool_name,
            error=str(e),
            fallback_attempted=False,
            response_text="The WebMCP action failed. I'll try the standard way.",
        ).model_dump()
