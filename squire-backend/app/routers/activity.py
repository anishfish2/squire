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
    """Get the current active session for a user"""
    try:
        print(f"📋 Getting current session for user {user_id}")

        # Get the most recent active session (session_end is NULL)
        result = supabase.table("user_sessions").select("id").eq(
            "user_id", user_id
        ).is_("session_end", "null").order("created_at", desc=True).limit(1).execute()

        if result.data and len(result.data) > 0:
            session_id = result.data[0]["id"]
            print(f"✅ Found active session {session_id}")
            return {
                "status": "success",
                "session_id": session_id
            }
        else:
            print(f"❌ No active session found for user {user_id}")
            raise HTTPException(status_code=404, detail="No active session found")

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error getting current session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get current session: {str(e)}")

@router.post("/activity-batch")
async def store_activity_batch(activity_data: ActivityBatchRequest):
    """Store batch of activity events to track user interactions"""
    try:
        print(f"📊 Storing activity batch: {len(activity_data.events)} events for user {activity_data.user_id}")

        # Prepare batch insert data
        events_to_insert = []

        for event in activity_data.events:
            # Determine importance based on event type
            importance_score = {
                "app_switch": 0.7,
                "window_switch": 0.5,
                "mouse_click": 0.3,
                "key_press": 0.2,
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

        # Batch insert to Supabase
        if events_to_insert:
            result = supabase.table("user_events").insert(events_to_insert).execute()
            print(f"✅ Successfully stored {len(events_to_insert)} activity events")

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
        print(f"❌ Error storing activity batch: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to store activity events: {str(e)}")

@router.post("/session-stats")
async def store_session_stats(stats_data: SessionStatsRequest):
    """Store session-level statistics"""
    try:
        print(f"📈 Storing session stats for user {stats_data.user_id}")

        # Store as a high-importance event
        event_record = {
            "user_id": stats_data.user_id,
            "event_type": "habit",
            "event_data": {
                "session_stats": stats_data.stats,
                "timestamp": datetime.now().timestamp() * 1000
            },
            "importance_score": 0.8,  # High importance for session summaries
            "session_id": stats_data.session_id,
            "tags": ["session_stats", "productivity_metrics"],
            "metadata": {
                "source": "activity_tracker",
                "stats_type": "session_summary"
            }
        }

        result = supabase.table("user_events").insert(event_record).execute()
        print(f"✅ Successfully stored session stats")

        return {
            "status": "success",
            "message": "Session stats stored successfully"
        }

    except Exception as e:
        print(f"❌ Error storing session stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to store session stats: {str(e)}")

@router.get("/recent-activity/{user_id}")
async def get_recent_activity(user_id: str, limit: int = 50):
    """Get recent activity events for a user"""
    try:
        result = supabase.table("user_events").select("*").eq(
            "user_id", user_id
        ).contains(
            "tags", ["activity_tracking"]
        ).order("created_at", desc=True).limit(limit).execute()

        return {
            "status": "success",
            "events": result.data if result.data else [],
            "count": len(result.data) if result.data else 0
        }

    except Exception as e:
        print(f"❌ Error retrieving recent activity: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve activity: {str(e)}")

@router.get("/activity-summary/{user_id}")
async def get_activity_summary(user_id: str, hours: int = 24):
    """Get activity summary for the last N hours"""
    try:
        # Calculate time threshold
        from datetime import datetime, timedelta
        time_threshold = (datetime.now() - timedelta(hours=hours)).isoformat()

        result = supabase.table("user_events").select("event_data").eq(
            "user_id", user_id
        ).contains(
            "tags", ["activity_tracking"]
        ).gte("created_at", time_threshold).execute()

        if not result.data:
            return {
                "status": "success",
                "summary": {"total_events": 0},
                "message": "No activity data found"
            }

        # Aggregate the data
        action_counts = {}
        app_activity = {}
        total_events = len(result.data)

        for event in result.data:
            event_data = event.get("event_data", {})
            action = event_data.get("action", "unknown")
            app_name = event_data.get("app_name", "Unknown")

            action_counts[action] = action_counts.get(action, 0) + 1
            app_activity[app_name] = app_activity.get(app_name, 0) + 1

        return {
            "status": "success",
            "summary": {
                "total_events": total_events,
                "action_breakdown": action_counts,
                "app_activity": app_activity,
                "time_period_hours": hours
            }
        }

    except Exception as e:
        print(f"❌ Error generating activity summary: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate summary: {str(e)}")

@router.post("/profiles")
async def create_profile(profile_data: ProfileCreateRequest):
    """Create a user profile"""
    try:
        print(f"📋 Creating profile for user {profile_data.id}")

        # Insert profile data
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
            print(f"✅ Successfully created profile for user {profile_data.id}")
            return {
                "status": "success",
                "message": "Profile created successfully",
                "profile_id": profile_data.id
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create profile")

    except Exception as e:
        print(f"❌ Error creating profile: {e}")
        # Check if profile already exists
        try:
            existing_result = supabase.table("user_profiles").select("id").eq("id", profile_data.id).execute()
            if existing_result.data and len(existing_result.data) > 0:
                print(f"✅ Profile {profile_data.id} already exists")
                return {
                    "status": "exists",
                    "message": "Profile already exists",
                    "profile_id": profile_data.id
                }
        except Exception as check_error:
            print(f"❌ Error checking if profile exists: {check_error}")

        # Profile creation failed and doesn't exist
        raise HTTPException(status_code=500, detail=f"Failed to create profile: {str(e)}")

@router.post("/sessions")
async def create_session(session_data: SessionCreateRequest):
    """Create a user session"""
    try:
        print(f"📋 Creating session {session_data.id} for user {session_data.user_id}")

        # Insert session data
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
            print(f"✅ Successfully created session {session_data.id}")
            return {
                "status": "success",
                "message": "Session created successfully",
                "session_id": session_data.id
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create session")

    except Exception as e:
        print(f"❌ Error creating session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")

@router.post("/end-session/{session_id}")
async def end_session(session_id: str):
    """End a user session"""
    try:
        print(f"📋 Ending session {session_id}")

        # Update session to set session_end and change type to closed
        result = supabase.table("user_sessions").update({
            "session_end": datetime.now().isoformat(),
            "session_type": "closed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", session_id).eq("session_type", "active").execute()

        if result.data:
            print(f"✅ Successfully ended session {session_id}")
            return {
                "status": "success",
                "message": "Session ended successfully",
                "session_id": session_id
            }
        else:
            # Session might not exist or already ended
            return {
                "status": "not_found",
                "message": "Session not found or already ended",
                "session_id": session_id
            }

    except Exception as e:
        print(f"❌ Error ending session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to end session: {str(e)}")