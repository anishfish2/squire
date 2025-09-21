"""
Analytics and Insights routes
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from uuid import UUID

from app.core.database import get_supabase, execute_rpc, execute_query, DatabaseError
from app.models.schemas import DashboardData, SessionInsights, BehaviorPatterns

router = APIRouter()


@router.get("/dashboard/{user_id}", response_model=dict)
async def get_dashboard_data(
    user_id: UUID,
    days: int = Query(30, ge=1, le=365),
    supabase=Depends(get_supabase)
):
    """Get comprehensive dashboard data"""
    try:
        from datetime import datetime, timedelta
        start_date = (datetime.now() - timedelta(days=days)).isoformat()

        # Get all data types
        sessions = await execute_query(
            table="user_sessions",
            operation="select",
            filters={"user_id": str(user_id)}
        )

        suggestions = await execute_query(
            table="ai_suggestions",
            operation="select",
            filters={"user_id": str(user_id)}
        )

        events = await execute_query(
            table="user_events",
            operation="select",
            filters={"user_id": str(user_id)}
        )

        nodes = await execute_query(
            table="knowledge_nodes",
            operation="select",
            filters={"user_id": str(user_id)}
        )

        relationships = await execute_query(
            table="knowledge_relationships",
            operation="select",
            filters={"user_id": str(user_id)}
        )

        # Filter by date
        recent_sessions = [s for s in (sessions or []) if s.get("created_at", "") >= start_date]
        recent_suggestions = [s for s in (suggestions or []) if s.get("created_at", "") >= start_date]
        recent_events = [e for e in (events or []) if e.get("created_at", "") >= start_date]

        dashboard = {
            "overview": {
                "total_sessions": len(recent_sessions),
                "active_sessions": len([s for s in recent_sessions if not s.get("session_end")]),
                "total_suggestions": len(recent_suggestions),
                "pending_suggestions": len([s for s in recent_suggestions if s.get("status") == "pending"]),
                "total_events": len(recent_events),
                "knowledge_nodes": len(nodes or []),
                "knowledge_relationships": len(relationships or [])
            },
            "trends": {
                "daily_sessions": {},  # Would implement daily counting
                "daily_events": {},    # Would implement daily counting
                "suggestion_response_rate": (
                    len([s for s in recent_suggestions if s.get("status") != "pending"]) / len(recent_suggestions)
                    if recent_suggestions else 0
                )
            },
            "productivity": {
                "avg_session_duration": 0,  # Would calculate from session data
                "most_active_hours": [],    # Would analyze session times
                "top_event_types": [],      # Would count event types
                "knowledge_growth": {}      # Would track node creation over time
            },
            "ai_insights": {
                "suggestion_accuracy": 0,   # Would calculate from feedback
                "top_suggestion_types": [], # Would count suggestion types
                "confidence_distribution": {} # Would analyze confidence scores
            }
        }

        return {"dashboard": dashboard}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session-insights/{session_id}", response_model=dict)
async def get_session_insights(
    session_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get detailed session insights"""
    try:
        session = await execute_query(
            table="user_sessions",
            operation="select",
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


@router.get("/behavior-patterns/{user_id}", response_model=dict)
async def get_behavior_patterns(
    user_id: UUID,
    days: int = Query(30, ge=1, le=365),
    pattern_type: Optional[str] = Query(None),
    supabase=Depends(get_supabase)
):
    """Get behavioral patterns"""
    try:
        from datetime import datetime, timedelta
        start_date = (datetime.now() - timedelta(days=days)).isoformat()

        events = await execute_query(
            table="user_events",
            operation="select",
            filters={"user_id": str(user_id)},
            order_by="created_at",
            ascending=True
        )

        # Filter by date
        recent_events = [e for e in (events or []) if e.get("created_at", "") >= start_date]

        patterns = {
            "temporal": {
                "hourly": [0] * 24,
                "daily": {},
                "weekly": [0] * 7
            },
            "frequency": {},
            "sequences": {},
            "triggers": {}
        }

        # Analyze patterns (simplified implementation)
        for event in recent_events:
            # This would be more sophisticated in a real implementation
            event_type = event.get("event_type", "unknown")
            patterns["frequency"][event_type] = patterns["frequency"].get(event_type, 0) + 1

        if pattern_type and pattern_type in patterns:
            return {"patterns": {pattern_type: patterns[pattern_type]}}
        else:
            return {"patterns": patterns}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/knowledge-insights/{user_id}", response_model=dict)
async def get_knowledge_insights(
    user_id: UUID,
    supabase=Depends(get_supabase)
):
    """Get knowledge graph insights"""
    try:
        nodes = await execute_query(
            table="knowledge_nodes",
            operation="select",
            filters={"user_id": str(user_id)}
        )

        relationships = await execute_query(
            table="knowledge_relationships",
            operation="select",
            filters={"user_id": str(user_id)}
        )

        insights = {
            "graph_metrics": {
                "total_nodes": len(nodes or []),
                "total_relationships": len(relationships or []),
                "avg_node_weight": 0,
                "avg_relationship_strength": 0
            },
            "learning_progress": {},
            "knowledge_clusters": {},
            "growth_trends": {},
            "connection_strength": {}
        }

        if nodes:
            weights = [n.get("weight", 0) for n in nodes]
            insights["graph_metrics"]["avg_node_weight"] = sum(weights) / len(weights)

        if relationships:
            strengths = [r.get("strength", 0) for r in relationships]
            insights["graph_metrics"]["avg_relationship_strength"] = sum(strengths) / len(strengths)

        return {"insights": insights}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health-check", response_model=dict)
async def get_health_check(
    supabase=Depends(get_supabase)
):
    """Database health check"""
    try:
        health = await execute_rpc("database_health_check")
        return {"health": health}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))