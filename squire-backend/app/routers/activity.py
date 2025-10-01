from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid

from app.core.database import supabase

router = APIRouter()

class ActivityEvent(BaseModel):
    action: str = Field(..., description="Type of action: mouse_click, mouse_move, key_press, app_switch, window_switch")
    app_name: Optional[str] = Field(None, description="App where action occurred")
    window_title: Optional[str] = Field(None, description="Window title if available")
    timestamp: float = Field(..., description="Timestamp of the event")
    details: Dict[str, Any] = Field(default_factory=dict, description="Additional event details")

class ActivityBatchRequest(BaseModel):
    user_id: str = Field(..., description="User ID")
    session_id: Optional[str] = Field(None, description="Current session ID")
    events: List[ActivityEvent] = Field(..., description="Batch of activity events")

class SessionStatsRequest(BaseModel):
    user_id: str = Field(..., description="User ID")
    session_id: Optional[str] = Field(None, description="Current session ID")
    stats: Dict[str, Any] = Field(..., description="Session statistics")

class ProfileCreateRequest(BaseModel):
    id: str = Field(..., description="User ID")
    email: str = Field(..., description="User email")
    full_name: str = Field(..., description="User full name")
    created_at: str = Field(..., description="Creation timestamp")
    updated_at: str = Field(..., description="Update timestamp")
    last_active: str = Field(..., description="Last active timestamp")
    subscription_tier: str = Field(..., description="Subscription tier")
    timezone: str = Field(..., description="User timezone")

class SessionCreateRequest(BaseModel):
    id: str = Field(..., description="Session ID")
    user_id: str = Field(..., description="User ID")
    device_info: Dict[str, Any] = Field(..., description="Device information")
    session_start: str = Field(..., description="Session start timestamp")
    session_type: str = Field(..., description="Session type")
    created_at: str = Field(..., description="Creation timestamp")
    updated_at: str = Field(..., description="Update timestamp")

@router.get("/current-session/{user_id}")
async def get_current_session(user_id: str):
    try:
        result = supabase.table("user_sessions").select("id").eq(
            "user_id", user_id
        ).is_("session_end", "null").order("created_at", desc=True).limit(1).execute()

        if result.data and len(result.data) > 0:
            session_id = result.data[0]["id"]
            return {
                "status": "success",
                "session_id": session_id
            }
        else:
            raise HTTPException(status_code=404, detail="No active session found")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get current session: {str(e)}")

@router.post("/activity-batch")
async def store_activity_batch(activity_data: ActivityBatchRequest):
    try:
        events_to_insert = []

        for event in activity_data.events:
            # Skip keystroke events - they should be sent to /api/ai/keystroke-analysis
            if event.action == "key_press" or event.action == "keystroke":
                print(f"⚠️ Skipping keystroke event - use /api/ai/keystroke-analysis endpoint")
                continue

            importance_score = {
                "app_switch": 0.7,
                "window_switch": 0.5,
                "mouse_click": 0.3,
                "mouse_move": 0.1
            }.get(event.action, 0.3)

            event_record = {
                "id": str(uuid.uuid4()),
                "user_id": activity_data.user_id,
                "event_type": "interaction",
                "event_data": {
                    "action": event.action,
                    "app_name": event.app_name,
                    "window_title": event.window_title,
                    "timestamp": event.timestamp,
                    "details": event.details
                },
                "importance_score": importance_score,
                "session_id": activity_data.session_id,
                "tags": [event.action, "activity_tracking"],
                "created_at": datetime.now().isoformat(),
                "metadata": {
                    "batch_id": str(uuid.uuid4()),
                    "source": "activity_tracker"
                }
            }
            events_to_insert.append(event_record)

        if events_to_insert:
            result = supabase.table("user_events").insert(events_to_insert).execute()

            return {
                "status": "success",
                "events_stored": len(events_to_insert),
                "message": f"Successfully stored {len(events_to_insert)} activity events"
            }
        else:
            return {
                "status": "success",
                "events_stored": 0,
                "message": "No events to store"
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store activity events: {str(e)}")

@router.post("/session-stats")
async def store_session_stats(stats_data: SessionStatsRequest):
    try:
        event_record = {
            "user_id": stats_data.user_id,
            "event_type": "habit",
            "event_data": {
                "session_stats": stats_data.stats,
                "timestamp": datetime.now().timestamp() * 1000
            },
            "importance_score": 0.8,
            "session_id": stats_data.session_id,
            "tags": ["session_stats", "productivity_metrics"],
            "metadata": {
                "source": "activity_tracker",
                "stats_type": "session_summary"
            }
        }

        result = supabase.table("user_events").insert(event_record).execute()

        return {
            "status": "success",
            "message": "Session stats stored successfully"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store session stats: {str(e)}")


@router.post("/profiles")
async def create_profile(profile_data: ProfileCreateRequest):
    try:
        result = supabase.table("user_profiles").insert({
            "id": profile_data.id,
            "email": profile_data.email,
            "full_name": profile_data.full_name,
            "created_at": profile_data.created_at,
            "updated_at": profile_data.updated_at,
            "last_active": profile_data.last_active,
            "subscription_tier": profile_data.subscription_tier,
            "timezone": profile_data.timezone
        }).execute()

        if result.data:
            return {
                "status": "success",
                "message": "Profile created successfully",
                "profile_id": profile_data.id
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create profile")

    except Exception as e:
        try:
            existing_result = supabase.table("user_profiles").select("id").eq("id", profile_data.id).execute()
            if existing_result.data and len(existing_result.data) > 0:
                return {
                    "status": "exists",
                    "message": "Profile already exists",
                    "profile_id": profile_data.id
                }
        except Exception as check_error:
            pass

        raise HTTPException(status_code=500, detail=f"Failed to create profile: {str(e)}")

@router.post("/sessions")
async def create_session(session_data: SessionCreateRequest):
    try:

        result = supabase.table("user_sessions").insert({
            "id": session_data.id,
            "user_id": session_data.user_id,
            "device_info": session_data.device_info,
            "session_start": session_data.session_start,
            "session_type": session_data.session_type,
            "created_at": session_data.created_at,
            "updated_at": session_data.updated_at
        }).execute()

        if result.data:
            return {
                "status": "success",
                "message": "Session created successfully",
                "session_id": session_data.id
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create session")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")

@router.post("/end-session/{session_id}")
async def end_session(session_id: str):
    try:
        result = supabase.table("user_sessions").update({
            "session_end": datetime.now().isoformat(),
            "session_type": "closed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", session_id).eq("session_type", "active").execute()

        if result.data:
            return {
                "status": "success",
                "message": "Session ended successfully",
                "session_id": session_id
            }
        else:
            return {
                "status": "not_found",
                "message": "Session not found or already ended",
                "session_id": session_id
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to end session: {str(e)}")