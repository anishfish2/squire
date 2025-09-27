"""
Pydantic models for request/response schemas
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID
from enum import Enum


# Base models
class BaseResponse(BaseModel):
    """Base response model"""
    pass


class ErrorResponse(BaseModel):
    """Error response model"""
    error: str
    message: Optional[str] = None


# Session models
class SessionType(str, Enum):
    PRODUCTIVITY = "productivity"
    DEVELOPMENT = "development"
    RESEARCH = "research"
    GENERAL = "general"


class UserSessionCreate(BaseModel):
    user_id: UUID
    device_info: Dict[str, Any] = {}
    session_type: SessionType = SessionType.GENERAL


class UserSession(BaseModel):
    id: UUID
    user_id: UUID
    session_start: datetime
    session_end: Optional[datetime] = None
    device_info: Dict[str, Any] = {}
    session_type: str
    created_at: datetime
    updated_at: datetime


# OCR Event models
class OCREventCreate(BaseModel):
    session_id: UUID
    app_name: str
    window_title: str = ""
    ocr_text: List[str] = []
    context_data: Dict[str, Any] = {}


class OCREvent(BaseModel):
    id: UUID
    session_id: UUID
    app_name: str
    window_title: str
    ocr_text: List[str]
    context_data: Dict[str, Any]
    created_at: datetime


# AI Suggestion models
class AISuggestionCreate(BaseModel):
    session_id: UUID
    ocr_event_id: Optional[UUID] = None
    suggestion_type: str
    title: str
    content: Dict[str, Any]
    confidence_score: float
    priority: int
    context_data: Dict[str, Any] = {}


class AISuggestion(BaseModel):
    id: UUID
    session_id: UUID
    ocr_event_id: Optional[UUID]
    suggestion_type: str
    title: str
    content: Dict[str, Any]
    confidence_score: float
    priority: int
    context_data: Dict[str, Any]
    status: str = "pending"
    created_at: datetime
    updated_at: datetime


# Combined request/response models for the AI endpoint
class AIContextRequest(BaseModel):
    user_id: UUID
    app_name: str
    window_title: str = ""
    ocr_text: List[str] = []
    user_context: Dict[str, Any] = {}
    current_session: Dict[str, Any] = {}
    context_signals: Dict[str, Any] = {}
    recent_ocr_context: Dict[str, Any] = {}


class AIContextResponse(BaseModel):
    session_id: UUID
    ocr_event_id: UUID
    suggestions: List[Dict[str, Any]]
    message: str = "Data saved successfully"


# User Profile models
class UserProfileCreate(BaseModel):
    email: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    timezone: str = "UTC"
    preferences: Dict[str, Any] = {}
    settings: Dict[str, Any] = {}


class UserProfile(BaseModel):
    id: UUID
    email: str
    full_name: Optional[str]
    avatar_url: Optional[str]
    timezone: str
    preferences: Dict[str, Any]
    settings: Dict[str, Any]
    metadata: Dict[str, Any]
    created_at: datetime
    updated_at: datetime


# User Events models
class EventType(str, Enum):
    APP_SWITCH = "app_switch"
    OCR_CAPTURE = "ocr_capture"
    SUGGESTION_CLICK = "suggestion_click"
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    ERROR_OCCURRED = "error_occurred"


class UserEventCreate(BaseModel):
    session_id: UUID
    event_type: EventType
    event_data: Dict[str, Any] = {}
    importance_score: float = 0.5


class UserEvent(BaseModel):
    id: UUID
    session_id: UUID
    event_type: str
    event_data: Dict[str, Any]
    importance_score: float
    created_at: datetime


# Knowledge Graph models
class NodeType(str, Enum):
    CONCEPT = "concept"
    SKILL = "skill"
    TOOL = "tool"
    WORKFLOW = "workflow"
    PATTERN = "pattern"


class KnowledgeNodeCreate(BaseModel):
    user_id: UUID
    node_type: NodeType
    name: str
    description: str = ""
    properties: Dict[str, Any] = {}
    weight: float = 1.0


class KnowledgeNode(BaseModel):
    id: UUID
    user_id: UUID
    node_type: str
    name: str
    description: str
    properties: Dict[str, Any]
    weight: float
    connections: List[UUID] = []
    created_at: datetime
    updated_at: datetime


class KnowledgeConnectionCreate(BaseModel):
    from_node_id: UUID
    to_node_id: UUID
    connection_type: str
    strength: float = 0.5
    metadata: Dict[str, Any] = {}


# Analytics models
class UsageMetrics(BaseModel):
    user_id: UUID
    date: datetime
    app_usage: Dict[str, int]  # app_name -> minutes_used
    suggestions_generated: int
    suggestions_clicked: int
    session_duration: int  # minutes
    productivity_score: float
    focus_score: float


class ProductivityAnalytics(BaseModel):
    user_id: UUID
    period_start: datetime
    period_end: datetime
    total_sessions: int
    avg_session_duration: float
    top_apps: List[Dict[str, Any]]
    productivity_trends: Dict[str, float]
    suggestions_effectiveness: float