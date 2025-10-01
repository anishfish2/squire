from fastapi import APIRouter, HTTPException
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/ws", tags=["websockets"])


@router.get("/stats")
async def get_websocket_stats():
    try:
        stats = ws_manager.get_connection_stats()
        return {
            "status": "active",
            "websocket_stats": stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting WebSocket stats: {str(e)}")

