from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from app.routers import ai, activity, websocket, vision, llm
from app.services.websocket_manager import ws_manager
from app.core.config import settings
from app.core.database import supabase
import socketio


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting Squire Backend API...")
    print("🔌 WebSocket Manager ready for connections")

    # Start OCR job manager
    print("🔄 Starting OCR job manager...")
    await ai.ocr_job_manager.start()
    print("✅ OCR job manager started")

    yield

    # Stop OCR job manager
    print("🛑 Stopping OCR job manager...")
    await ai.ocr_job_manager.stop()
    print("🛑 Shutting down Squire Backend API...")


app = FastAPI(
    title="Squire Backend API",
    description="Complete API for OCR tracking, AI suggestions, and knowledge graph",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.ALLOWED_HOSTS:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.ALLOWED_HOSTS
    )

app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(activity.router, prefix="/api/activity", tags=["activity"])
app.include_router(websocket.router, prefix="/api/ws", tags=["websockets"])
app.include_router(vision.router)
app.include_router(llm.router)

socket_app = socketio.ASGIApp(ws_manager.sio, app)


@app.get("/")
async def root():
    return {
        "message": "Squire Backend API",
        "version": "1.0.0",
        "documentation": "/docs",
        "routes": {
            "ocr_queue": "/api/ai/ocr/queue/context",
            "batch_context": "/api/ai/batch-context",
            "ocr_job_status": "/api/ai/ocr/job/{job_id}",
            "ocr_queue_stats": "/api/ai/ocr/queue/stats",
            "ai_health": "/api/ai/health",
            "activity_batch": "/api/activity/activity-batch",
            "session_stats": "/api/activity/session-stats",
            "profiles": "/api/activity/profiles",
            "sessions": "/api/activity/sessions",
            "websocket_stats": "/api/ws/stats"
        }
    }


@app.get("/health")
async def health_check():
    try:
        response = await supabase.rpc("database_health_check").execute()
        db_status = "healthy" if response.data else "unhealthy"
    except Exception:
        db_status = "unhealthy"

    return {
        "status": "healthy",
        "database": db_status,
        "timestamp": "2024-01-01T00:00:00Z",
        "version": "1.0.0"
    }


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": str(exc) if settings.DEBUG else "Something went wrong"
        }
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail}
    )


if __name__ == "__main__":
    uvicorn.run(
        "main:socket_app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info"
    )
