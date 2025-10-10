"""
Actions API Router
Handles action execution requests
"""
from fastapi import APIRouter, HTTPException, Depends, status, Request
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from uuid import UUID

from app.middleware.auth import get_current_user, jwt_bearer
from app.services.action_executor import action_executor

router = APIRouter(prefix="/api/actions", tags=["Actions"])


# Request/Response Models
class ActionStep(BaseModel):
    """Single action step to execute"""
    action_type: str = Field(..., description="Type of action (e.g., 'calendar_create_event', 'gmail_send')")
    action_params: Dict[str, Any] = Field(..., description="Parameters for the action")
    requires_approval: bool = Field(default=True, description="Whether user approval is required")
    priority: int = Field(default=5, ge=1, le=10, description="Action priority (1-10)")


class ExecuteDirectRequest(BaseModel):
    """Request to execute direct actions (Flow A)"""
    action_steps: List[ActionStep] = Field(..., description="List of action steps to execute")
    suggestion_id: Optional[str] = Field(None, description="ID of suggestion that generated these actions")


class ActionResultResponse(BaseModel):
    """Result of a single action execution"""
    success: bool
    data: Dict[str, Any] = {}
    error: Optional[str] = None
    metadata: Dict[str, Any] = {}
    timestamp: str


class ExecuteDirectResponse(BaseModel):
    """Response from direct action execution"""
    success: bool
    results: List[ActionResultResponse]
    total_actions: int
    successful_actions: int
    failed_actions: int


class ApproveActionRequest(BaseModel):
    """Request to approve a pending action"""
    action_id: str


class GetPendingActionsResponse(BaseModel):
    """Response with pending actions"""
    actions: List[Dict[str, Any]]
    total: int


# Endpoints

@router.post("/execute-direct", response_model=ExecuteDirectResponse)
async def execute_direct_actions(
    request_body: ExecuteDirectRequest,
    request: Request,
    token: str = Depends(jwt_bearer)
):
    """
    Execute a list of direct actions (Flow A)

    This endpoint is used when the backend has already determined
    the exact action steps to execute.

    Example:
    ```json
    {
      "action_steps": [
        {
          "action_type": "calendar_create_event",
          "action_params": {
            "title": "Meeting with John",
            "start": "2025-10-09T15:00:00Z",
            "end": "2025-10-09T16:00:00Z",
            "description": "Discuss project timeline"
          },
          "requires_approval": true,
          "priority": 8
        }
      ],
      "suggestion_id": "550e8400-e29b-41d4-a716-446655440000"
    }
    ```

    Returns:
        ExecuteDirectResponse with results for each action
    """
    # Get user from request state (set by jwt_bearer middleware)
    if not hasattr(request.state, 'user') or request.state.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    user_id = request.state.user["id"]
    print(f"✅ Executing actions for user: {user_id}")

    try:
        # Convert Pydantic models to dicts
        action_steps_dicts = [step.dict() for step in request_body.action_steps]

        # Execute actions
        results = await action_executor.execute_direct_actions(
            user_id=user_id,
            action_steps=action_steps_dicts,
            suggestion_id=request_body.suggestion_id
        )

        # Count successes and failures
        successful = sum(1 for r in results if r.success)
        failed = sum(1 for r in results if not r.success)

        return ExecuteDirectResponse(
            success=failed == 0,  # Overall success if no failures
            results=[ActionResultResponse(**r.to_dict()) for r in results],
            total_actions=len(results),
            successful_actions=successful,
            failed_actions=failed
        )

    except Exception as e:
        print(f"❌ Error in execute_direct_actions: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute actions: {str(e)}"
        )


@router.post("/approve/{action_id}")
async def approve_action(
    action_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Approve a pending action

    Used when an action requires user approval before execution.

    Args:
        action_id: UUID of the action to approve

    Returns:
        Success status
    """
    user_id = current_user["id"]

    try:
        success = await action_executor._approve_action(action_id, user_id)

        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Action not found or already processed"
            )

        return {
            "success": True,
            "action_id": action_id,
            "status": "approved"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error approving action: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/reject/{action_id}")
async def reject_action(
    action_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Reject a pending action

    Args:
        action_id: UUID of the action to reject

    Returns:
        Success status
    """
    user_id = current_user["id"]

    try:
        from app.core.database import supabase

        # Update action status to rejected
        result = supabase.rpc(
            "update_action_status",
            {
                "p_action_id": action_id,
                "p_new_status": "rejected"
            }
        ).execute()

        return {
            "success": True,
            "action_id": action_id,
            "status": "rejected"
        }

    except Exception as e:
        print(f"❌ Error rejecting action: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/pending", response_model=GetPendingActionsResponse)
async def get_pending_actions(
    limit: int = 10,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get list of pending actions requiring approval

    Args:
        limit: Maximum number of actions to return (default: 10)

    Returns:
        List of pending actions
    """
    user_id = current_user["id"]

    try:
        from app.core.database import supabase

        # Get pending actions
        result = supabase.rpc(
            "get_pending_actions",
            {
                "p_user_id": user_id,
                "p_limit": limit
            }
        ).execute()

        actions = result.data if result.data else []

        return GetPendingActionsResponse(
            actions=actions,
            total=len(actions)
        )

    except Exception as e:
        print(f"❌ Error getting pending actions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/history")
async def get_action_history(
    limit: int = 50,
    status_filter: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get user's action execution history

    Args:
        limit: Maximum number of actions to return
        status_filter: Filter by status (pending, approved, executing, completed, failed, rejected, cancelled)

    Returns:
        List of action history
    """
    user_id = current_user["id"]

    try:
        from app.core.database import supabase

        query = supabase.table("action_queue")\
            .select("*")\
            .eq("user_id", user_id)\
            .order("created_at", desc=True)\
            .limit(limit)

        if status_filter:
            query = query.eq("status", status_filter)

        result = query.execute()

        return {
            "actions": result.data,
            "total": len(result.data)
        }

    except Exception as e:
        print(f"❌ Error getting action history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/health")
async def actions_health():
    """Health check for actions API"""
    return {
        "status": "ok",
        "service": "actions",
        "available_actions": list(action_executor.agent_registry.keys())
    }
