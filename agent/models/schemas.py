"""
agent/models/schemas.py
All Pydantic v2 data models for Axis.
"""
from __future__ import annotations
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


class InteractiveElement(BaseModel):
    element_type: Literal["button", "input", "link", "select", "form", "other"]
    label: str
    selector: Optional[str] = None
    purpose: str


class ScreenshotAnalysis(BaseModel):
    page_summary: str
    interactive_elements: list[InteractiveElement] = Field(default_factory=list)
    form_fields: list[dict] = Field(
        default_factory=list,
        description="A list of form fields visible on the page (e.g., {'label': 'Email', 'selector': '#email_input'})"
    )
    webmcp_available: bool = False
    suggested_mode: Literal["webmcp", "dom", "voice_only"] = "dom"


class ActionPlan(BaseModel):
    intent: str
    mode: Literal["webmcp", "dom", "voice_only"]
    tool_name: Optional[str] = None
    tool_args: Optional[dict] = None
    dom_selector: Optional[str] = None
    dom_action: Optional[Literal["click", "type", "scroll", "select"]] = None
    dom_value: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    explanation: str


class ActionResult(BaseModel):
    success: bool
    mode_used: Literal["webmcp", "dom", "voice_only"]
    tool_name: Optional[str] = None
    error: Optional[str] = None
    fallback_attempted: bool = False
    response_text: str


class SessionEvent(BaseModel):
    session_id: str
    tab_id: str
    user_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    event_type: Literal["voice_command", "screenshot_taken", "action_executed", "error"]
    user_intent: Optional[str] = None
    action_plan: Optional[ActionPlan] = None
    action_result: Optional[ActionResult] = None
    page_url: str = ""
    page_title: str = ""


class WebSocketMessage(BaseModel):
    type: Literal[
        "audio_chunk", "screenshot_result", "webmcp_tools",
        "action_result", "audio_response", "request_screenshot",
        "execute_webmcp", "execute_dom", "status", "error"
    ]
    session_id: str
    data: Optional[str] = None
    tab_id: Optional[str] = None
    tools: Optional[list[dict]] = None
    tool_name: Optional[str] = None
    args: Optional[dict] = None
    selector: Optional[str] = None
    action: Optional[str] = None
    value: Optional[str] = None
    message: Optional[str] = None
    success: Optional[bool] = None
