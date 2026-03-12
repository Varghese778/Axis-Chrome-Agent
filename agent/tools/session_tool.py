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
