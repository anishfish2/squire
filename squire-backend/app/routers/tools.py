"""Tool metadata endpoints."""

from fastapi import APIRouter, Depends

import app.tools  # ensure built-in tools are registered
from app.middleware.auth import jwt_bearer
from app.tools.formatters import as_action_metadata

router = APIRouter(prefix="/api/tools", tags=["tools"])


@router.get("/metadata", dependencies=[Depends(jwt_bearer)])
async def list_tool_metadata():
    """Return canonical tool metadata for clients."""
    return {"tools": as_action_metadata()}

