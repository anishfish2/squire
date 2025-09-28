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
from dotenv import load_dotenv

# Load environment variables explicitly
load_dotenv()

# Import routers
from app.routers import ai
from app.core.config import settings
from app.core.database import supabase


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Starting Squire Backend API...")
    yield
    # Shutdown
    print("Shutting down Squire Backend API...")


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
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])


@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "message": "Squire Backend API",
        "version": "1.0.0",
        "documentation": "/docs",
        "routes": {
            "ai_suggestions": "/api/ai/suggestions",
            "ai_context": "/api/ai/context",
            "ai_health": "/api/ai/health"
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
        "timestamp": "2024-01-01T00:00:00Z",
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
