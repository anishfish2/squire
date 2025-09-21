"""
Pydantic models for request/response schemas
"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from uuid import UUID
from enum import Enum


# Base models
class BaseResponse(BaseModel):
    """Base response model"""
    model_config = ConfigDict(from_attributes=True)


class ErrorResponse(BaseModel):
    """Error response model"""
    error: str
    message: Optional[str] = None


# User Profile models
class UserProfileCreate(BaseModel):
    email: str = Field(..., description="User email address")
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    timezone: str = Field(default="UTC", description="User timezone")


class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    preferences: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    timezone: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


class UserProfile(BaseResponse):
    id: UUID
    email: str
    full_name: Optional[str]
    avatar_url: Optional[str]
    created_at: datetime
    updated_at: datetime
    preferences: Dict[str, Any]
    metadata: Dict[str, Any]
    timezone: str
    last_active: Optional[datetime]
    subscription_tier: str
    settings: Dict[str, Any]


# Session models
class SessionType(str, Enum):
    ACTIVE = "active"
    BACKGROUND = "background"
    IDLE = "idle"
    CLOSED = "closed"


class SessionStart(BaseModel):
    user_id: UUID
    device_info: Dict[str, Any] = Field(default_factory=dict)
    session_type: SessionType = SessionType.ACTIVE


class SessionEvent(BaseModel):
    event_type: str = Field(..., description="Type of event (ocr, click, mouse_movement)")
    event_data: Dict[str, Any] = Field(..., description="Event data")


class SessionEventBulk(BaseModel):
    events: List[SessionEvent]


class SessionUpdate(BaseModel):
    session_data: Optional[Dict[str, Any]] = None
    app_usage: Optional[Dict[str, Any]] = None
    session_type: Optional[SessionType] = None


class UserSession(BaseResponse):
    id: UUID
    user_id: UUID
    session_start: datetime
    session_end: Optional[datetime]
    session_data: Dict[str, Any]
    ocr_logs: List[Dict[str, Any]]
    mouse_movements: List[Dict[str, Any]]
    clicks: List[Dict[str, Any]]
    app_usage: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
    session_type: SessionType
    device_info: Dict[str, Any]


# AI Suggestion models
class SuggestionType(str, Enum):
    PRODUCTIVITY = "productivity"
    WORKFLOW = "workflow"
    AUTOMATION = "automation"
    OPTIMIZATION = "optimization"
    LEARNING = "learning"
    REMINDER = "reminder"
    INSIGHT = "insight"


class SuggestionStatus(str, Enum):
    PENDING = "pending"
    VIEWED = "viewed"
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"
    EXPIRED = "expired"


class SuggestionCreate(BaseModel):
    user_id: UUID
    session_ids: List[UUID] = Field(default_factory=list)
    suggestion_type: SuggestionType
    suggestion_content: Dict[str, Any]
    confidence_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    context_data: Dict[str, Any] = Field(default_factory=dict)
    expires_hours: int = Field(default=168, description="Hours until expiration")
    priority: int = Field(default=5, ge=1, le=10)


class SuggestionStatusUpdate(BaseModel):
    status: SuggestionStatus
    feedback: Optional[Dict[str, Any]] = None


class SuggestionUpdate(BaseModel):
    suggestion_content: Optional[Dict[str, Any]] = None
    confidence_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    context_data: Optional[Dict[str, Any]] = None
    expires_at: Optional[datetime] = None
    priority: Optional[int] = Field(None, ge=1, le=10)
    metadata: Optional[Dict[str, Any]] = None


class AISuggestion(BaseResponse):
    id: UUID
    user_id: UUID
    session_ids: List[UUID]
    suggestion_type: SuggestionType
    suggestion_content: Dict[str, Any]
    confidence_score: Optional[float]
    context_data: Dict[str, Any]
    status: SuggestionStatus
    created_at: datetime
    expires_at: Optional[datetime]
    feedback: Dict[str, Any]
    metadata: Dict[str, Any]
    priority: int


# User Event models
class EventType(str, Enum):
    INTERACTION = "interaction"
    PREFERENCE = "preference"
    PATTERN = "pattern"
    HABIT = "habit"
    SKILL = "skill"
    GOAL = "goal"
    WORKFLOW = "workflow"
    ERROR = "error"
    SUCCESS = "success"


class UserEventCreate(BaseModel):
    user_id: UUID
    event_type: EventType
    event_data: Dict[str, Any]
    importance_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    tags: List[str] = Field(default_factory=list)
    session_id: Optional[UUID] = None
    related_suggestion_id: Optional[UUID] = None


class UserEventUpdate(BaseModel):
    event_data: Optional[Dict[str, Any]] = None
    importance_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    tags: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None


class UserEventBulk(BaseModel):
    events: List[UserEventCreate]


class UserEvent(BaseResponse):
    id: UUID
    user_id: UUID
    event_type: EventType
    event_data: Dict[str, Any]
    importance_score: float
    created_at: datetime
    tags: List[str]
    session_id: Optional[UUID]
    related_suggestion_id: Optional[UUID]
    metadata: Dict[str, Any]


# Knowledge Graph models
class NodeType(str, Enum):
    CONCEPT = "concept"
    HABIT = "habit"
    PREFERENCE = "preference"
    SKILL = "skill"
    TOOL = "tool"
    WORKFLOW = "workflow"
    GOAL = "goal"
    PATTERN = "pattern"
    CONTEXT = "context"


class RelationshipType(str, Enum):
    DEPENDS_ON = "depends_on"
    LEADS_TO = "leads_to"
    CONFLICTS_WITH = "conflicts_with"
    SIMILAR_TO = "similar_to"
    PART_OF = "part_of"
    TRIGGERS = "triggers"
    REINFORCES = "reinforces"
    REPLACES = "replaces"
    ENABLES = "enables"


class KnowledgeNodeCreate(BaseModel):
    user_id: UUID
    node_type: NodeType
    content: Dict[str, Any]
    weight: float = Field(default=1.0, ge=0.0, le=10.0)
    source_event_ids: List[UUID] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class KnowledgeNodeUpdate(BaseModel):
    content: Optional[Dict[str, Any]] = None
    weight: Optional[float] = Field(None, ge=0.0, le=10.0)
    metadata: Optional[Dict[str, Any]] = None


class KnowledgeNode(BaseResponse):
    id: UUID
    user_id: UUID
    node_type: NodeType
    content: Dict[str, Any]
    weight: float
    last_updated: datetime
    created_at: datetime
    source_events: List[UUID]
    access_count: int
    metadata: Dict[str, Any]


class KnowledgeRelationshipCreate(BaseModel):
    user_id: UUID
    source_node_id: UUID
    target_node_id: UUID
    relationship_type: RelationshipType
    strength: float = Field(default=0.5, ge=0.0, le=1.0)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class KnowledgeRelationship(BaseResponse):
    id: UUID
    user_id: UUID
    source_node_id: UUID
    target_node_id: UUID
    relationship_type: RelationshipType
    strength: float
    created_at: datetime
    last_reinforced: datetime
    reinforcement_count: int
    metadata: Dict[str, Any]


# Analytics models
class DashboardData(BaseResponse):
    overview: Dict[str, Any]
    trends: Dict[str, Any]
    productivity: Dict[str, Any]
    ai_insights: Dict[str, Any]


class SessionInsights(BaseResponse):
    duration_minutes: float
    click_count: int
    ocr_count: int
    most_used_app: Optional[str]
    productivity_score: str


class BehaviorPatterns(BaseResponse):
    frequency: Dict[str, Any]
    sequences: Dict[str, Any]
    trends: Dict[str, Any]


# Management models
class CleanupRequest(BaseModel):
    dry_run: bool = True


class SessionCleanupRequest(BaseModel):
    archive_after_days: int = 90
    batch_size: int = 1000


class EventCleanupRequest(BaseModel):
    importance_threshold: float = 0.30
    older_than_days: int = 30
    batch_size: int = 1000


class SuggestionCleanupRequest(BaseModel):
    older_than_days: int = 30
    batch_size: int = 1000


class KnowledgeGraphCleanupRequest(BaseModel):
    min_strength: float = 0.10
    min_reinforcement_count: int = 1
    batch_size: int = 500


class UserDeleteRequest(BaseModel):
    confirmation_email: str


class BackupRequest(BaseModel):
    include_sessions: bool = True
    include_events: bool = True


class RestoreRequest(BaseModel):
    backup_data: Dict[str, Any]
    overwrite: bool = False


# Response models
class SuccessResponse(BaseResponse):
    success: bool = True
    message: str
    data: Optional[Dict[str, Any]] = None


class CleanupResponse(BaseResponse):
    success: bool
    message: str
    count: int