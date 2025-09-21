"""
Squire Backend API - FastAPI Implementation
OCR tracking, AI suggestions, and knowledge graph
"""
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import os
from contextlib import asynccontextmanager

# Import routers
from app.routers import (
    profiles,
    sessions,
    suggestions,
    events,
    knowledge,
    analytics,
    management
)
from app.core.config import settings
from app.core.database import supabase


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("🚀 Starting Squire Backend API...")
    yield
    # Shutdown
    print("🛑 Shutting down Squire Backend API...")


# Create FastAPI app
app = FastAPI(
    title="Squire Backend API",
    description="Complete API for OCR tracking, AI suggestions, and knowledge graph",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Trusted host middleware
if settings.ALLOWED_HOSTS:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.ALLOWED_HOSTS
    )

# Include routers
app.include_router(profiles.router, prefix="/api/profiles", tags=["profiles"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(suggestions.router, prefix="/api/suggestions", tags=["suggestions"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(knowledge.router, prefix="/api/knowledge", tags=["knowledge"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(management.router, prefix="/api/management", tags=["management"])


@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "message": "Squire Backend API",
        "version": "1.0.0",
        "documentation": "/docs",
        "routes": {
            "profiles": "/api/profiles",
            "sessions": "/api/sessions",
            "suggestions": "/api/suggestions",
            "events": "/api/events",
            "knowledge": "/api/knowledge",
            "analytics": "/api/analytics",
            "management": "/api/management"
        }
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        response = await supabase.rpc("database_health_check").execute()
        db_status = "healthy" if response.data else "unhealthy"
    except Exception:
        db_status = "unhealthy"

    return {
        "status": "healthy",
        "database": db_status,
        "timestamp": "2024-01-01T00:00:00Z",  # This would be current timestamp
        "version": "1.0.0"
    }


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Global exception handler"""
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": str(exc) if settings.DEBUG else "Something went wrong"
        }
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """HTTP exception handler"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail}
    )


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info"
    )