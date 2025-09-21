"""
Data Management routes (GDPR, Cleanup, Export)
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Response
from fastapi.responses import JSONResponse
from typing import Optional
from uuid import UUID

from app.core.database import get_supabase, execute_rpc, execute_query, DatabaseError
from app.models.schemas import (
    CleanupRequest,
    SessionCleanupRequest,
    EventCleanupRequest,
    SuggestionCleanupRequest,
    KnowledgeGraphCleanupRequest,
    UserDeleteRequest,
    BackupRequest,
    RestoreRequest,
    SuccessResponse
)

router = APIRouter()


@router.post("/cleanup/comprehensive", response_model=dict)
async def comprehensive_cleanup(
    cleanup_data: CleanupRequest,
    supabase=Depends(get_supabase)
):
    """Run comprehensive cleanup"""
    try:
        result = await execute_rpc(
            "comprehensive_cleanup",
            {"p_dry_run": cleanup_data.dry_run}
        )

        return {
            "success": True,
            "cleanup_results": result,
            "dry_run": cleanup_data.dry_run
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cleanup/sessions", response_model=dict)
async def cleanup_sessions(
    cleanup_data: SessionCleanupRequest,
    supabase=Depends(get_supabase)
):
    """Archive old sessions"""
    try:
        count = await execute_rpc(
            "archive_old_sessions",
            {
                "p_archive_after_days": cleanup_data.archive_after_days,
                "p_batch_size": cleanup_data.batch_size
            }
        )

        return {
            "success": True,
            "message": f"{count} sessions archived",
            "archived_count": count
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cleanup/events", response_model=dict)
async def cleanup_events(
    cleanup_data: EventCleanupRequest,
    supabase=Depends(get_supabase)
):
    """Clean up low importance events"""
    try:
        count = await execute_rpc(
            "cleanup_low_importance_events",
            {
                "p_importance_threshold": cleanup_data.importance_threshold,
                "p_older_than_days": cleanup_data.older_than_days,
                "p_batch_size": cleanup_data.batch_size
            }
        )

        return {
            "success": True,
            "message": f"{count} low-importance events cleaned up",
            "cleaned_count": count
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cleanup/suggestions", response_model=dict)
async def cleanup_suggestions(
    cleanup_data: SuggestionCleanupRequest,
    supabase=Depends(get_supabase)
):
    """Clean up old suggestions"""
    try:
        count = await execute_rpc(
            "cleanup_old_suggestions",
            {
                "p_older_than_days": cleanup_data.older_than_days,
                "p_batch_size": cleanup_data.batch_size
            }
        )

        return {
            "success": True,
            "message": f"{count} old suggestions cleaned up",
            "cleaned_count": count
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cleanup/knowledge-graph", response_model=dict)
async def cleanup_knowledge_graph(
    cleanup_data: KnowledgeGraphCleanupRequest,
    supabase=Depends(get_supabase)
):
    """Prune weak knowledge connections"""
    try:
        count = await execute_rpc(
            "prune_knowledge_graph",
            {
                "p_min_strength": cleanup_data.min_strength,
                "p_min_reinforcement_count": cleanup_data.min_reinforcement_count,
                "p_batch_size": cleanup_data.batch_size
            }
        )

        return {
            "success": True,
            "message": f"{count} weak relationships pruned",
            "pruned_count": count
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/{user_id}")
async def export_user_data(
    user_id: UUID,
    format: str = Query("json", regex="^(json|csv)$"),
    supabase=Depends(get_supabase)
):
    """Export all user data (GDPR)"""
    try:
        data = await execute_rpc(
            "export_user_data",
            {"p_user_id": str(user_id)}
        )

        if format == "json":
            return JSONResponse(
                content=data,
                headers={
                    "Content-Disposition": f"attachment; filename=user-data-{user_id}.json"
                }
            )
        elif format == "csv":
            # Convert to CSV (simplified implementation)
            csv_data = "data_type,id,created_at,content\n"

            # Add profile data
            if data.get("user_profile"):
                profile = data["user_profile"]
                csv_data += f"profile,{profile.get('id', '')},{profile.get('created_at', '')},\"{str(profile)}\"\n"

            # Add sessions
            for session in data.get("sessions", []):
                csv_data += f"session,{session.get('id', '')},{session.get('created_at', '')},\"{str(session)}\"\n"

            # Add events
            for event in data.get("events", []):
                csv_data += f"event,{event.get('id', '')},{event.get('created_at', '')},\"{str(event)}\"\n"

            return Response(
                content=csv_data,
                media_type="text/csv",
                headers={
                    "Content-Disposition": f"attachment; filename=user-data-{user_id}.csv"
                }
            )
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/user/{user_id}", response_model=dict)
async def delete_user_data(
    user_id: UUID,
    delete_request: UserDeleteRequest,
    supabase=Depends(get_supabase)
):
    """Delete all user data (GDPR)"""
    try:
        result = await execute_rpc(
            "delete_user_data",
            {
                "p_user_id": str(user_id),
                "p_confirmation_email": delete_request.confirmation_email
            }
        )

        return {
            "success": True,
            "message": "User data deleted successfully",
            "deletion_summary": result
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/backup/user/{user_id}", response_model=dict)
async def backup_user_data(
    user_id: UUID,
    backup_request: BackupRequest,
    supabase=Depends(get_supabase)
):
    """Create user data backup"""
    try:
        from datetime import datetime

        # Get user profile
        profile = await execute_query(
            table="user_profiles",
            operation="select",
            filters={"id": str(user_id)},
            single=True
        )

        if not profile:
            raise HTTPException(status_code=404, detail="User not found")

        backup = {
            "backup_timestamp": datetime.now().isoformat(),
            "user_id": str(user_id),
            "profile": profile
        }

        if backup_request.include_sessions:
            sessions = await execute_query(
                table="user_sessions",
                operation="select",
                filters={"user_id": str(user_id)},
                order_by="created_at",
                ascending=False,
                limit=1000
            )
            backup["sessions"] = sessions or []

        if backup_request.include_events:
            events = await execute_query(
                table="user_events",
                operation="select",
                filters={"user_id": str(user_id)},
                order_by="created_at",
                ascending=False,
                limit=5000
            )
            backup["events"] = events or []

        # Get AI suggestions
        suggestions = await execute_query(
            table="ai_suggestions",
            operation="select",
            filters={"user_id": str(user_id)}
        )
        backup["suggestions"] = suggestions or []

        # Get knowledge graph
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

        backup["knowledge_graph"] = {
            "nodes": nodes or [],
            "relationships": relationships or []
        }

        backup_size_kb = len(str(backup)) / 1024

        return {
            "success": True,
            "backup": backup,
            "metadata": {
                "backup_size_kb": backup_size_kb,
                "record_counts": {
                    "sessions": len(backup.get("sessions", [])),
                    "events": len(backup.get("events", [])),
                    "suggestions": len(backup.get("suggestions", [])),
                    "knowledge_nodes": len(backup["knowledge_graph"]["nodes"]),
                    "knowledge_relationships": len(backup["knowledge_graph"]["relationships"])
                }
            }
        }
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/storage-stats", response_model=dict)
async def get_storage_stats(
    supabase=Depends(get_supabase)
):
    """Get storage statistics"""
    try:
        table_stats = {}
        tables = ["user_profiles", "user_sessions", "ai_suggestions", "user_events", "knowledge_nodes", "knowledge_relationships"]

        for table in tables:
            try:
                # Get count (simplified - in real implementation would use COUNT query)
                data = await execute_query(table=table, operation="select", columns="id", limit=1)
                table_stats[table] = {"record_count": len(data or [])}
            except:
                table_stats[table] = {"record_count": 0}

        # Get database health
        try:
            health_data = await execute_rpc("database_health_check")
        except:
            health_data = None

        stats = {
            "table_statistics": table_stats,
            "database_health": health_data,
            "last_updated": datetime.now().isoformat()
        }

        return {"storage_stats": stats}
    except DatabaseError as e:
        raise HTTPException(status_code=500, detail=str(e))