"""
agent/tools/imagegen_tool.py
Tool for generating AI images via the backend REST endpoint.
"""
import httpx
import logging
from google.adk.tools import FunctionTool

logger = logging.getLogger(__name__)

async def generate_image(prompt: str, session_id: str = "") -> dict:
    """
    Generate an image from a text description and return it to the user.
    Use this when the user asks to draw, create, generate, or visualise something.
    Args:
        prompt: detailed description of the image.
        session_id: current session ID.
    """
    url = "https://axis-backend-461115625041.us-central1.run.app/generate-image"
    payload = {
        "prompt": prompt,
        "session_id": session_id
    }

    logger.info(f"Tool calling generate-image with prompt: {prompt[:60]}...")

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Error in generate_image tool: {e}")
            return {"success": False, "error": str(e)}

generate_image_tool = FunctionTool(func=generate_image)
