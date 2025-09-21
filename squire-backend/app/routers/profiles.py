"""
User Profile routes
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from uuid import UUID

from app.core.database import get_supabase, execute_rpc, execute_query, DatabaseError
from app.models.schemas import (
    UserProfile,
    UserProfileCreate,
    UserProfileUpdate,
    SuccessResponse,
    ErrorResponse
)

router = APIRouter()


@router.get("/{user_id}", response_model=UserProfile)
async def get_user_profile(
    user_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get user profile by ID"""
    try:
        data = await execute_query(
            table="user_profiles",
            operation="select",
            filters={"id": str(user_id)},
            single=True
        )

        if not data:
            raise HTTPException(status_code=404, detail="Profile not found")

        return UserProfile(**data)
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=dict)
async def create_user_profile(
    profile_data: UserProfileCreate,
    supabase=Depends(get_supabase)
):
    """Create new user profile"""
    try:
        # Use the database function to create profile
        profile_id = await execute_rpc(
            "create_user_profile",
            {
                "p_email": profile_data.email,
                "p_full_name": profile_data.full_name,
                "p_avatar_url": profile_data.avatar_url,
                "p_timezone": profile_data.timezone
            }
        )

        # Get the created profile
        profile = await execute_query(
            table="user_profiles",
            operation="select",
            filters={"id": str(profile_id)},
            single=True
        )

        return {
            "profile": UserProfile(**profile),
            "id": profile_id
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{user_id}", response_model=UserProfile)
async def update_user_profile(
    user_id: UUID,
    profile_data: UserProfileUpdate,
    supabase=Depends(get_supabase)
):
    """Update user profile"""
    try:
        # Build update data
        update_data = {}
        if profile_data.full_name is not None:
            update_data["full_name"] = profile_data.full_name
        if profile_data.avatar_url is not None:
            update_data["avatar_url"] = profile_data.avatar_url
        if profile_data.preferences is not None:
            update_data["preferences"] = profile_data.preferences
        if profile_data.metadata is not None:
            update_data["metadata"] = profile_data.metadata
        if profile_data.timezone is not None:
            update_data["timezone"] = profile_data.timezone
        if profile_data.settings is not None:
            update_data["settings"] = profile_data.settings

        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")

        data = await execute_query(
            table="user_profiles",
            operation="update",
            data=update_data,
            filters={"id": str(user_id)},
            single=True
        )

        if not data:
            raise HTTPException(status_code=404, detail="Profile not found")

        return UserProfile(**data)
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{user_id}/stats", response_model=dict)
async def get_user_stats(
    user_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get user statistics"""
    try:
        # Get sessions
        sessions = await execute_query(
            table="user_sessions",
            operation="select",
            columns="id, created_at, session_end",
            filters={"user_id": str(user_id)}
        )

        # Get suggestions
        suggestions = await execute_query(
            table="ai_suggestions",
            operation="select",
            columns="id, status, confidence_score",
            filters={"user_id": str(user_id)}
        )

        # Get events
        events = await execute_query(
            table="user_events",
            operation="select",
            columns="id, event_type, importance_score",
            filters={"user_id": str(user_id)}
        )

        # Get knowledge nodes
        nodes = await execute_query(
            table="knowledge_nodes",
            operation="select",
            columns="id, node_type, weight",
            filters={"user_id": str(user_id)}
        )

        # Calculate statistics
        stats = {
            "sessions": {
                "total": len(sessions or []),
                "active": len([s for s in (sessions or []) if not s.get("session_end")])
            },
            "suggestions": {
                "total": len(suggestions or []),
                "pending": len([s for s in (suggestions or []) if s.get("status") == "pending"]),
                "avg_confidence": (
                    sum(s.get("confidence_score", 0) for s in (suggestions or [])) / len(suggestions)
                    if suggestions else 0
                )
            },
            "events": {
                "total": len(events or []),
                "high_importance": len([e for e in (events or []) if e.get("importance_score", 0) > 0.7])
            },
            "knowledge": {
                "total_nodes": len(nodes or []),
                "by_type": {}
            }
        }

        # Calculate nodes by type
        if nodes:
            for node in nodes:
                node_type = node.get("node_type", "unknown")
                stats["knowledge"]["by_type"][node_type] = (
                    stats["knowledge"]["by_type"].get(node_type, 0) + 1
                )

        return {"stats": stats}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))