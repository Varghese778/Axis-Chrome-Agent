"""
agent/tools/plan_tool.py
Handles multi-step plan generation and UI updates for complex voice tasks.
"""
import logging
from typing import List

logger = logging.getLogger(__name__)


async def plan_and_execute(steps: List[str], task_description: str) -> dict:
    """
    Use this tool when the user gives you a complex task that requires multiple steps
    (like filling out a form, checking multiple things, or writing code).
    Emits a task plan to the user interface to show them what you are doing.
    After this tool returns successfully, you MUST sequentially execute the steps
    you planned out using your other tools (e.g. screenshot_tool, execute_dom_action).

    steps: A list of short string descriptions for each step.
    task_description: A short title summarizing the overall goal.
    """
    try:
        from backend.main import session_manager

        state = session_manager.get_active()
        if not state:
            return {"success": False, "error": "No active browser session"}

        # Send task plan payload to extension via WebSocket
        await state.websocket.send_json({
            "type": "task_plan",
            "task": task_description,
            "steps": steps,
        })

        logger.info(f"plan_and_execute fired: {task_description} ({len(steps)} steps)")
        
        return {
            "success": True, 
            "message": "Plan accepted. Please begin processing step 1 using the appropriate tools."
        }

    except Exception as e:
        logger.error(f"plan_and_execute error: {e}")
        return {"success": False, "error": str(e)}
