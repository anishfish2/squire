"""
LLM Router for handling chat API endpoints.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import json
import logging

from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["llm"])


class Message(BaseModel):
    """Chat message model."""
    role: str  # 'system', 'user', or 'assistant'
    content: str


class ChatRequest(BaseModel):
    """Chat completion request model."""
    model: str
    messages: List[Message]
    stream: bool = True
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = None


async def generate_stream(request: ChatRequest):
    """Generate Server-Sent Events stream for chat completion."""
    try:
        # Convert Pydantic models to dicts
        messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]

        # Prepare kwargs
        kwargs = {}
        if request.temperature is not None:
            kwargs['temperature'] = request.temperature
        if request.max_tokens is not None:
            kwargs['max_tokens'] = request.max_tokens

        # Stream the response
        async for chunk in llm_service.stream_chat_completion(
            messages=messages,
            model=request.model,
            **kwargs
        ):
            if 'error' in chunk:
                # Send error event
                yield f"data: {json.dumps({'error': chunk['error']})}\n\n"
                break
            elif 'done' in chunk:
                # Send completion event
                yield f"data: [DONE]\n\n"
                break
            elif 'content' in chunk:
                # Send content chunk
                yield f"data: {json.dumps({'content': chunk['content']})}\n\n"

    except Exception as e:
        logger.error(f"Error in generate_stream: {e}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


@router.post("/stream")
async def stream_chat(request: ChatRequest):
    """
    Stream chat completion.

    Args:
        request: ChatRequest with model, messages, and options

    Returns:
        StreamingResponse with Server-Sent Events
    """
    try:
        return StreamingResponse(
            generate_stream(request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )
    except Exception as e:
        logger.error(f"Error in stream_chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/completion")
async def chat_completion(request: ChatRequest):
    """
    Non-streaming chat completion.

    Args:
        request: ChatRequest with model, messages, and options

    Returns:
        Complete response as JSON
    """
    try:
        # Convert Pydantic models to dicts
        messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]

        # Prepare kwargs
        kwargs = {}
        if request.temperature is not None:
            kwargs['temperature'] = request.temperature
        if request.max_tokens is not None:
            kwargs['max_tokens'] = request.max_tokens

        # Collect all chunks
        full_response = ""
        async for chunk in llm_service.stream_chat_completion(
            messages=messages,
            model=request.model,
            **kwargs
        ):
            if 'error' in chunk:
                raise HTTPException(status_code=500, detail=chunk['error'])
            elif 'content' in chunk:
                full_response += chunk['content']

        return {
            "model": request.model,
            "message": {
                "role": "assistant",
                "content": full_response
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat_completion endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/models")
async def list_models():
    """
    List available LLM models.

    Returns:
        List of available models with their providers
    """
    models = [
        {"id": "gpt-4", "name": "GPT-4", "provider": "OpenAI"},
        {"id": "gpt-4-turbo", "name": "GPT-4 Turbo", "provider": "OpenAI"},
        {"id": "gpt-3.5-turbo", "name": "GPT-3.5 Turbo", "provider": "OpenAI"},
        {"id": "claude-3-opus", "name": "Claude 3 Opus", "provider": "Anthropic"},
        {"id": "claude-3-sonnet", "name": "Claude 3 Sonnet", "provider": "Anthropic"},
        {"id": "claude-3-haiku", "name": "Claude 3 Haiku", "provider": "Anthropic"},
        {"id": "gemini-pro", "name": "Gemini Pro", "provider": "Google"},
    ]

    # Filter to only show models with available API keys
    available_models = []
    for model in models:
        try:
            llm_service._get_provider(model['id'])
            available_models.append(model)
        except ValueError:
            pass

    return {"models": available_models}
