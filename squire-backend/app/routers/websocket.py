"""
WebSocket routes for real-time communication
"""
from fastapi import APIRouter, HTTPException
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/ws", tags=["websockets"])


@router.get("/stats")
async def get_websocket_stats():
    """Get WebSocket connection statistics"""
    try:
        stats = ws_manager.get_connection_stats()
        return {
            "status": "active",
            "websocket_stats": stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting WebSocket stats: {str(e)}")


@router.post("/emit/ocr-complete")
async def emit_ocr_completion(data: dict):
    """Test endpoint to emit OCR completion (for testing)"""
    try:
        user_id = data.get('user_id')
        job_data = data.get('job_data', {})

        if not user_id:
            raise HTTPException(status_code=400, detail="user_id required")

        success = await ws_manager.emit_ocr_job_complete(user_id, job_data)

        return {
            "success": success,
            "message": f"OCR completion {'sent' if success else 'failed'} for user {user_id}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error emitting OCR completion: {str(e)}")


@router.post("/emit/batch-progress")
async def emit_batch_progress(data: dict):
    """Test endpoint to emit batch progress (for testing)"""
    try:
        session_id = data.get('session_id')
        progress_data = data.get('progress_data', {})

        if not session_id:
            raise HTTPException(status_code=400, detail="session_id required")

        success = await ws_manager.emit_batch_progress(session_id, progress_data)

        return {
            "success": success,
            "message": f"Batch progress {'sent' if success else 'failed'} for session {session_id}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error emitting batch progress: {str(e)}")


# The actual WebSocket endpoint will be mounted at the application level
# See main.py for the socketio.ASGIApp mount