"""
Session Management routes
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from uuid import UUID

from app.core.database import get_supabase, execute_rpc, execute_query, DatabaseError
from app.models.schemas import (
    UserSession,
    SessionStart,
    SessionEvent,
    SessionEventBulk,
    SessionUpdate,
    SuccessResponse,
    ErrorResponse
)

router = APIRouter()


@router.post("/start", response_model=dict)
async def start_session(
    session_data: SessionStart,
    supabase=Depends(get_supabase)
):
    """Start a new user session"""
    try:
        session_id = await execute_rpc(
            "start_user_session",
            {
                "p_user_id": str(session_data.user_id),
                "p_device_info": session_data.device_info,
                "p_session_type": session_data.session_type.value
            }
        )

        # Get the created session
        session = await execute_query(
            table="user_sessions",
            operation="select",
            filters={"id": str(session_id)},
            single=True
        )

        return {
            "session": UserSession(**session),
            "session_id": session_id
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{session_id}/end", response_model=SuccessResponse)
async def end_session(
    session_id: UUID,
    supabase=Depends(get_supabase)
):
    """End a session"""
    try:
        result = await execute_rpc(
            "end_user_session",
            {"p_session_id": str(session_id)}
        )

        if not result:
            raise HTTPException(status_code=404, detail="Session not found or already ended")

        return SuccessResponse(message="Session ended successfully")
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/events", response_model=SuccessResponse)
async def add_session_event(
    session_id: UUID,
    event: SessionEvent,
    supabase=Depends(get_supabase)
):
    """Add an event to a session"""
    try:
        result = await execute_rpc(
            "add_session_event",
            {
                "p_session_id": str(session_id),
                "p_event_type": event.event_type,
                "p_event_data": event.event_data
            }
        )

        if not result:
            raise HTTPException(status_code=404, detail="Session not found")

        return SuccessResponse(message="Event added successfully")
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/events/bulk", response_model=dict)
async def add_session_events_bulk(
    session_id: UUID,
    events_data: SessionEventBulk,
    supabase=Depends(get_supabase)
):
    """Add multiple events to a session"""
    try:
        results = []
        for event in events_data.events:
            try:
                result = await execute_rpc(
                    "add_session_event",
                    {
                        "p_session_id": str(session_id),
                        "p_event_type": event.event_type,
                        "p_event_data": event.event_data
                    }
                )
                results.append({"success": True, "event": event.dict()})
            except Exception as e:
                results.append({"success": False, "error": str(e), "event": event.dict()})

        successful_count = sum(1 for r in results if r["success"])
        return {
            "results": results,
            "total": len(events_data.events),
            "successful": successful_count,
            "failed": len(events_data.events) - successful_count
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}", response_model=UserSession)
async def get_session(
    session_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get session details"""
    try:
        session = await execute_query(
            table="user_sessions",
            operation="select",
            filters={"id": str(session_id)},
            single=True
        )

        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        return UserSession(**session)
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user/{user_id}", response_model=dict)
async def get_user_sessions(
    user_id: UUID,
    limit: int = Query(50, le=1000),
    offset: int = Query(0, ge=0),
    active_only: bool = Query(False),
    supabase=Depends(get_supabase)
):
    """Get all sessions for a user"""
    try:
        filters = {"user_id": str(user_id)}

        # If active_only, we need to add a filter for session_end IS NULL
        # This would need to be handled in the execute_query function or manually
        sessions = await execute_query(
            table="user_sessions",
            operation="select",
            filters=filters,
            order_by="created_at",
            ascending=False,
            limit=limit,
            offset=offset
        )

        if active_only and sessions:
            sessions = [s for s in sessions if not s.get("session_end")]

        return {"sessions": [UserSession(**session) for session in (sessions or [])]}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user/{user_id}/active", response_model=dict)
async def get_active_sessions(
    user_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get active sessions for user"""
    try:
        sessions = await execute_query(
            table="user_sessions",
            operation="select",
            filters={"user_id": str(user_id)},
            order_by="session_start",
            ascending=False
        )

        # Filter for active sessions (session_end is null)
        active_sessions = [s for s in (sessions or []) if not s.get("session_end")]

        return {"active_sessions": [UserSession(**session) for session in active_sessions]}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/insights", response_model=dict)
async def get_session_insights(
    session_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get session insights"""
    try:
        # First verify session exists and get user_id
        session = await execute_query(
            table="user_sessions",
            operation="select",
            columns="user_id",
            filters={"id": str(session_id)},
            single=True
        )

        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        insights = await execute_rpc(
            "generate_session_insights",
            {
                "p_user_id": str(session["user_id"]),
                "p_session_id": str(session_id)
            }
        )

        return {"insights": insights}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{session_id}", response_model=UserSession)
async def update_session(
    session_id: UUID,
    session_data: SessionUpdate,
    supabase=Depends(get_supabase)
):
    """Update session data"""
    try:
        update_data = {}
        if session_data.session_data is not None:
            update_data["session_data"] = session_data.session_data
        if session_data.app_usage is not None:
            update_data["app_usage"] = session_data.app_usage
        if session_data.session_type is not None:
            update_data["session_type"] = session_data.session_type.value

        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")

        session = await execute_query(
            table="user_sessions",
            operation="update",
            data=update_data,
            filters={"id": str(session_id)},
            single=True
        )

        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        return UserSession(**session)
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))