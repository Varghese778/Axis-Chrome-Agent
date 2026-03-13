"""
agent/tools/imagegen_tool.py
Tool for generating AI images via the backend REST endpoint.
"""
import httpx
import logging

logger = logging.getLogger(__name__)

async def generate_image(prompt: str, session_id: str = "") -> dict:
    """
    Generate an image from a text description and return it to the user. Use this when the user asks to draw, create, generate, or visualise something.
    """
    url = "http://localhost:8080/generate-image"
    payload = {
        "prompt": prompt,
        "session_id": session_id
    }
    
    logger.info(f"Tool calling generate-image with prompt: {prompt[:60]}...")
    
    # Use httpx.AsyncClient with a timeout of 60 seconds (Prompt 2)
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Error in generate_image tool: {e}")
            return {"success": False, "error": str(e)}

# Export as generate_image_tool to match Axis_agent.py expectations
generate_image_tool = generate_image
