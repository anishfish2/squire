"""
AI Suggestions routes
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from uuid import UUID

from app.core.database import get_supabase, execute_rpc, execute_query, DatabaseError
from app.models.schemas import (
    AISuggestion,
    SuggestionCreate,
    SuggestionUpdate,
    SuggestionStatusUpdate,
    SuggestionStatus,
    SuggestionType,
    SuccessResponse,
    ErrorResponse
)

router = APIRouter()


@router.post("/", response_model=dict)
async def create_suggestion(
    suggestion_data: SuggestionCreate,
    supabase=Depends(get_supabase)
):
    """Create new AI suggestion"""
    try:
        suggestion_id = await execute_rpc(
            "create_ai_suggestion",
            {
                "p_user_id": str(suggestion_data.user_id),
                "p_session_ids": [str(sid) for sid in suggestion_data.session_ids],
                "p_suggestion_type": suggestion_data.suggestion_type.value,
                "p_suggestion_content": suggestion_data.suggestion_content,
                "p_confidence_score": suggestion_data.confidence_score,
                "p_context_data": suggestion_data.context_data,
                "p_expires_hours": suggestion_data.expires_hours,
                "p_priority": suggestion_data.priority
            }
        )

        # Get the created suggestion
        suggestion = await execute_query(
            table="ai_suggestions",
            operation="select",
            filters={"id": str(suggestion_id)},
            single=True
        )

        return {
            "suggestion": AISuggestion(**suggestion),
            "suggestion_id": suggestion_id
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user/{user_id}/active", response_model=dict)
async def get_active_suggestions(
    user_id: UUID,
    limit: int = Query(10, le=100),
    supabase=Depends(get_supabase)
):
    """Get active suggestions for user"""
    try:
        suggestions = await execute_rpc(
            "get_active_suggestions",
            {
                "p_user_id": str(user_id),
                "p_limit": limit
            }
        )

        return {"suggestions": suggestions or []}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{suggestion_id}", response_model=AISuggestion)
async def get_suggestion(
    suggestion_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get specific suggestion"""
    try:
        suggestion = await execute_query(
            table="ai_suggestions",
            operation="select",
            filters={"id": str(suggestion_id)},
            single=True
        )

        if not suggestion:
            raise HTTPException(status_code=404, detail="Suggestion not found")

        return AISuggestion(**suggestion)
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{suggestion_id}/status", response_model=SuccessResponse)
async def update_suggestion_status(
    suggestion_id: UUID,
    status_data: SuggestionStatusUpdate,
    supabase=Depends(get_supabase)
):
    """Update suggestion status"""
    try:
        result = await execute_rpc(
            "update_suggestion_status",
            {
                "p_suggestion_id": str(suggestion_id),
                "p_new_status": status_data.status.value,
                "p_feedback": status_data.feedback
            }
        )

        if not result:
            raise HTTPException(status_code=404, detail="Suggestion not found")

        return SuccessResponse(message="Status updated successfully")
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user/{user_id}", response_model=dict)
async def get_user_suggestions(
    user_id: UUID,
    status: Optional[SuggestionStatus] = Query(None),
    suggestion_type: Optional[SuggestionType] = Query(None),
    limit: int = Query(50, le=1000),
    offset: int = Query(0, ge=0),
    order_by: str = Query("created_at"),
    order_direction: str = Query("desc"),
    supabase=Depends(get_supabase)
):
    """Get all suggestions for user"""
    try:
        filters = {"user_id": str(user_id)}

        if status:
            filters["status"] = status.value
        if suggestion_type:
            filters["suggestion_type"] = suggestion_type.value

        suggestions = await execute_query(
            table="ai_suggestions",
            operation="select",
            filters=filters,
            order_by=order_by,
            ascending=(order_direction == "asc"),
            limit=limit,
            offset=offset
        )

        return {"suggestions": [AISuggestion(**s) for s in (suggestions or [])]}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{suggestion_id}", response_model=AISuggestion)
async def update_suggestion(
    suggestion_id: UUID,
    suggestion_data: SuggestionUpdate,
    supabase=Depends(get_supabase)
):
    """Update suggestion"""
    try:
        update_data = {}
        if suggestion_data.suggestion_content is not None:
            update_data["suggestion_content"] = suggestion_data.suggestion_content
        if suggestion_data.confidence_score is not None:
            update_data["confidence_score"] = suggestion_data.confidence_score
        if suggestion_data.context_data is not None:
            update_data["context_data"] = suggestion_data.context_data
        if suggestion_data.expires_at is not None:
            update_data["expires_at"] = suggestion_data.expires_at.isoformat()
        if suggestion_data.priority is not None:
            update_data["priority"] = suggestion_data.priority
        if suggestion_data.metadata is not None:
            update_data["metadata"] = suggestion_data.metadata

        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")

        suggestion = await execute_query(
            table="ai_suggestions",
            operation="update",
            data=update_data,
            filters={"id": str(suggestion_id)},
            single=True
        )

        if not suggestion:
            raise HTTPException(status_code=404, detail="Suggestion not found")

        return AISuggestion(**suggestion)
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{suggestion_id}", response_model=SuccessResponse)
async def delete_suggestion(
    suggestion_id: UUID,
    supabase=Depends(get_supabase)
):
    """Delete suggestion"""
    try:
        suggestion = await execute_query(
            table="ai_suggestions",
            operation="delete",
            filters={"id": str(suggestion_id)},
            single=True
        )

        if not suggestion:
            raise HTTPException(status_code=404, detail="Suggestion not found")

        return SuccessResponse(message="Suggestion deleted successfully")
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cleanup", response_model=dict)
async def cleanup_expired_suggestions(
    supabase=Depends(get_supabase)
):
    """Cleanup expired suggestions"""
    try:
        count = await execute_rpc("cleanup_expired_suggestions")

        return {
            "success": True,
            "message": f"{count} suggestions cleaned up",
            "cleaned_count": count
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/analytics/{user_id}", response_model=dict)
async def get_suggestion_analytics(
    user_id: UUID,
    days: int = Query(30, ge=1, le=365),
    supabase=Depends(get_supabase)
):
    """Get suggestion analytics for user"""
    try:
        # Calculate start date
        from datetime import datetime, timedelta
        start_date = (datetime.now() - timedelta(days=days)).isoformat()

        suggestions = await execute_query(
            table="ai_suggestions",
            operation="select",
            filters={"user_id": str(user_id)},
            # Note: We'd need to add date filtering capability to execute_query
            # For now, we'll filter in Python
        )

        if suggestions:
            # Filter by date in Python (would be better to do in database)
            filtered_suggestions = []
            for s in suggestions:
                if s.get("created_at", "") >= start_date:
                    filtered_suggestions.append(s)
            suggestions = filtered_suggestions

        analytics = {
            "total": len(suggestions or []),
            "by_status": {},
            "by_type": {},
            "avg_confidence": 0,
            "response_rate": 0
        }

        if suggestions:
            # Calculate by status
            for s in suggestions:
                status = s.get("status", "unknown")
                analytics["by_status"][status] = analytics["by_status"].get(status, 0) + 1

            # Calculate by type
            for s in suggestions:
                stype = s.get("suggestion_type", "unknown")
                analytics["by_type"][stype] = analytics["by_type"].get(stype, 0) + 1

            # Calculate average confidence
            confidences = [s.get("confidence_score", 0) for s in suggestions if s.get("confidence_score") is not None]
            if confidences:
                analytics["avg_confidence"] = sum(confidences) / len(confidences)

            # Calculate response rate
            responded = [s for s in suggestions if s.get("status") != "pending"]
            analytics["response_rate"] = len(responded) / len(suggestions)

        return {"analytics": analytics}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))