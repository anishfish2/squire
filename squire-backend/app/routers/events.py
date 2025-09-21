"""
User Events routes
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from uuid import UUID

from app.core.database import get_supabase, execute_rpc, execute_query, DatabaseError
from app.models.schemas import (
    UserEvent,
    UserEventCreate,
    UserEventUpdate,
    UserEventBulk,
    EventType,
    SuccessResponse
)

router = APIRouter()


@router.post("/", response_model=dict)
async def create_user_event(
    event_data: UserEventCreate,
    supabase=Depends(get_supabase)
):
    """Create new user event"""
    try:
        event_id = await execute_rpc(
            "add_user_event",
            {
                "p_user_id": str(event_data.user_id),
                "p_event_type": event_data.event_type.value,
                "p_event_data": event_data.event_data,
                "p_importance_score": event_data.importance_score,
                "p_tags": event_data.tags,
                "p_session_id": str(event_data.session_id) if event_data.session_id else None,
                "p_related_suggestion_id": str(event_data.related_suggestion_id) if event_data.related_suggestion_id else None
            }
        )

        event = await execute_query(
            table="user_events",
            operation="select",
            filters={"id": str(event_id)},
            single=True
        )

        return {
            "event": UserEvent(**event),
            "event_id": event_id
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user/{user_id}", response_model=dict)
async def get_user_events(
    user_id: UUID,
    event_type: Optional[EventType] = Query(None),
    min_importance: Optional[float] = Query(None, ge=0.0, le=1.0),
    tags: Optional[str] = Query(None),
    session_id: Optional[UUID] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
    order_by: str = Query("created_at"),
    order_direction: str = Query("desc"),
    supabase=Depends(get_supabase)
):
    """Get all events for user"""
    try:
        filters = {"user_id": str(user_id)}

        if event_type:
            filters["event_type"] = event_type.value
        if session_id:
            filters["session_id"] = str(session_id)

        events = await execute_query(
            table="user_events",
            operation="select",
            filters=filters,
            order_by=order_by,
            ascending=(order_direction == "asc"),
            limit=limit,
            offset=offset
        )

        # Filter by min_importance and tags in Python (would be better in DB)
        if events:
            if min_importance is not None:
                events = [e for e in events if e.get("importance_score", 0) >= min_importance]

            if tags:
                tag_list = tags.split(",")
                events = [e for e in events if any(tag in e.get("tags", []) for tag in tag_list)]

        return {"events": [UserEvent(**event) for event in (events or [])]}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{event_id}", response_model=UserEvent)
async def get_event(
    event_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get specific event"""
    try:
        event = await execute_query(
            table="user_events",
            operation="select",
            filters={"id": str(event_id)},
            single=True
        )

        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        return UserEvent(**event)
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk", response_model=dict)
async def create_events_bulk(
    events_data: UserEventBulk,
    supabase=Depends(get_supabase)
):
    """Create multiple events"""
    try:
        results = []
        for event in events_data.events:
            try:
                event_id = await execute_rpc(
                    "add_user_event",
                    {
                        "p_user_id": str(event.user_id),
                        "p_event_type": event.event_type.value,
                        "p_event_data": event.event_data,
                        "p_importance_score": event.importance_score,
                        "p_tags": event.tags,
                        "p_session_id": str(event.session_id) if event.session_id else None,
                        "p_related_suggestion_id": str(event.related_suggestion_id) if event.related_suggestion_id else None
                    }
                )
                results.append({"success": True, "event_id": event_id, "event": event.dict()})
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


@router.post("/process-to-knowledge/{user_id}", response_model=dict)
async def process_events_to_knowledge(
    user_id: UUID,
    batch_size: int = Query(100, ge=1, le=1000),
    supabase=Depends(get_supabase)
):
    """Process events to knowledge graph"""
    try:
        count = await execute_rpc(
            "process_events_to_knowledge",
            {
                "p_user_id": str(user_id),
                "p_batch_size": batch_size
            }
        )

        return {
            "success": True,
            "message": f"{count} events processed to knowledge graph",
            "processed_count": count
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))