"""
LLM Router for handling chat API endpoints.
"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional, Union
import json
import logging

from app.services.llm_service import llm_service
from app.services.action_detection_service import action_detection_service
from app.middleware.auth import get_current_user, jwt_bearer
import app.tools  # noqa: F401 (ensure built-in tools are registered)
from app.tools.registry import registry


def get_openai_tools() -> List[Dict[str, Any]]:
    """Render registered tools in OpenAI function-call format."""
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.json_schema(),
            },
        }
        for tool in sorted(registry.all(), key=lambda t: t.name)
    ]

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["llm"])


class Message(BaseModel):
    """Chat message model - supports OpenAI format including multimodal content."""
    role: str  # 'system', 'user', 'assistant', or 'tool'
    content: Optional[Union[str, List[Dict[str, Any]]]] = None  # String or multimodal array (for images)
    tool_calls: Optional[List[Dict[str, Any]]] = None  # For assistant messages
    tool_call_id: Optional[str] = None  # For tool response messages
    name: Optional[str] = None  # For tool response messages


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
        print(f"🚀 [LLM] Starting stream for model: {request.model}")
        logger.info(f"🚀 Starting stream for model: {request.model}")

        # Convert Pydantic models to dicts, preserving all OpenAI fields
        messages = []
        for msg in request.messages:
            message_dict = {"role": msg.role}

            # Add content if present
            if msg.content is not None:
                message_dict["content"] = msg.content

            # Add tool_calls for assistant messages
            if msg.tool_calls is not None:
                message_dict["tool_calls"] = msg.tool_calls

            # Add tool response fields
            if msg.tool_call_id is not None:
                message_dict["tool_call_id"] = msg.tool_call_id
            if msg.name is not None:
                message_dict["name"] = msg.name

            messages.append(message_dict)

        # Prepare kwargs
        kwargs = {}
        def model_requires_default_temperature(model_name: str) -> bool:
            if not model_name:
                return False
            lowered = model_name.lower()
            locked_prefixes = (
                "o1",          # OpenAI reasoning models (o1 family)
                "o4",          # OpenAI o4 family
                "gpt-4.1-reasoning",
                "gpt-4.1-mini-reasoning",
                "gpt-4o-realtime",
                "gpt-5"        # GPT-5 family requires default temperature
            )
            return any(lowered.startswith(prefix) for prefix in locked_prefixes)

        if request.temperature is not None and not model_requires_default_temperature(request.model):
            kwargs['temperature'] = request.temperature
        if request.max_tokens is not None:
            kwargs['max_tokens'] = request.max_tokens

        if 'gpt' in request.model.lower():
            kwargs['tools'] = get_openai_tools()
            kwargs['tool_choice'] = 'auto'

        # Add tools for GPT models (OpenAI function calling)
        if 'gpt' in request.model.lower():
            kwargs['tools'] = get_openai_tools()
            kwargs['tool_choice'] = 'auto'

        # Stream the response
        chunk_count = 0
        tool_calls_buffer = {}  # Buffer for accumulating tool call arguments
        last_tool_id = None  # Track the last tool ID for chunks without IDs

        async for chunk in llm_service.stream_chat_completion(
            messages=messages,
            model=request.model,
            **kwargs
        ):
            if 'error' in chunk:
                # Send error event
                logger.error(f"❌ Stream error: {chunk['error']}")
                yield f"data: {json.dumps({'error': chunk['error']})}\n\n"
                break
            elif 'done' in chunk:
                # Send any complete tool calls before completion
                if tool_calls_buffer:
                    print(f"📤 [Router] Sending {len(tool_calls_buffer)} buffered tool calls", flush=True)
                    for tool_id, tool_data in tool_calls_buffer.items():
                        print(f"   Tool call {tool_id}: {tool_data['name']}, args_len={len(tool_data['arguments'])}", flush=True)
                        print(f"   Arguments: {tool_data['arguments'][:200]}...", flush=True)  # Log first 200 chars
                        yield f"data: {json.dumps({'tool_call': tool_data})}\n\n"
                else:
                    print(f"⚠️ [Router] No tool calls buffered at completion!", flush=True)

                # Send completion event
                print(f"✅ [Router] Stream completed. Total chunks: {chunk_count}", flush=True)
                yield f"data: [DONE]\n\n"
                break
            elif 'content' in chunk:
                # Send content chunk
                chunk_count += 1
                yield f"data: {json.dumps({'content': chunk['content']})}\n\n"
            elif 'tool_call' in chunk:
                # Accumulate tool call data (DO NOT yield yet - buffer first!)
                tool_call = chunk['tool_call']
                tool_id = tool_call.get('id')

                # If no ID in this chunk, use the last known tool ID
                # (OpenAI sends ID only in first chunk, then None for argument chunks)
                if not tool_id and last_tool_id:
                    tool_id = last_tool_id
                    print(f"   🔄 [Router] Using last_tool_id: {tool_id}", flush=True)

                if tool_id:
                    # Create buffer if this is a new tool call
                    if tool_id not in tool_calls_buffer:
                        tool_calls_buffer[tool_id] = {
                            'id': tool_id,
                            'name': tool_call.get('name', ''),
                            'arguments': ''
                        }
                        last_tool_id = tool_id  # Remember this ID
                        print(f"🔧 [Router] Created tool call buffer: {tool_id} - {tool_call.get('name', '')}", flush=True)

                    # Accumulate arguments from this chunk
                    if tool_call.get('arguments'):
                        tool_calls_buffer[tool_id]['arguments'] += tool_call['arguments']
                        print(f"   📝 [Router] Accumulated args for {tool_id}, total length: {len(tool_calls_buffer[tool_id]['arguments'])}", flush=True)

                    # Update name if provided in this chunk
                    if tool_call.get('name') and not tool_calls_buffer[tool_id]['name']:
                        tool_calls_buffer[tool_id]['name'] = tool_call.get('name')

    except Exception as e:
        logger.error(f"❌ Error in generate_stream: {e}", exc_info=True)
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
        # Convert Pydantic models to dicts, preserving all OpenAI fields
        messages = []
        for msg in request.messages:
            message_dict = {"role": msg.role}

            # Add content if present
            if msg.content is not None:
                message_dict["content"] = msg.content

            # Add tool_calls for assistant messages
            if msg.tool_calls is not None:
                message_dict["tool_calls"] = msg.tool_calls

            # Add tool response fields
            if msg.tool_call_id is not None:
                message_dict["tool_call_id"] = msg.tool_call_id
            if msg.name is not None:
                message_dict["name"] = msg.name

            messages.append(message_dict)

        # Prepare kwargs
        kwargs = {}
        def model_requires_default_temperature(model_name: str) -> bool:
            if not model_name:
                return False
            lowered = model_name.lower()
            locked_prefixes = (
                "o1",
                "o4",
                "gpt-4.1-reasoning",
                "gpt-4.1-mini-reasoning",
                "gpt-4o-realtime",
                "gpt-5"
            )
            return any(lowered.startswith(prefix) for prefix in locked_prefixes)

        if request.temperature is not None and not model_requires_default_temperature(request.model):
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
        # OpenAI (official)
        {"id": "gpt-4o", "name": "GPT-4o (Latest)", "provider": "OpenAI"},
        {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "provider": "OpenAI"},
        {"id": "o1-preview", "name": "O1 Preview (Reasoning)", "provider": "OpenAI"},
        {"id": "o1-mini", "name": "O1 Mini (Reasoning)", "provider": "OpenAI"},
        {"id": "gpt-3.5-turbo", "name": "GPT-3.5 Turbo", "provider": "OpenAI"},

        # Anthropic (official model IDs include dates)
        {"id": "claude-3-opus-20240229", "name": "Claude 3 Opus", "provider": "Anthropic"},
        {"id": "claude-3-sonnet-20240229", "name": "Claude 3 Sonnet", "provider": "Anthropic"},
        {"id": "claude-3-haiku-20240307", "name": "Claude 3 Haiku", "provider": "Anthropic"},
        {"id": "claude-3-5-sonnet-20240620", "name": "Claude 3.5 Sonnet", "provider": "Anthropic"},

        # Google Gemini
        {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro", "provider": "Google"},
        {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "provider": "Google"},
        {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash", "provider": "Google"},
        {"id": "gemini-pro", "name": "Gemini Pro (Legacy)", "provider": "Google"},
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


class DetectActionsRequest(BaseModel):
    """Request to detect actions from a message."""
    message: str
    context: Optional[Dict[str, Any]] = None


@router.post("/detect-actions", dependencies=[Depends(jwt_bearer)])
async def detect_actions(
    request: DetectActionsRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    Detect executable actions from a user message.

    This endpoint analyzes a message and returns action steps if it contains
    actionable content (e.g., "schedule meeting tomorrow at 2pm").

    Args:
        request: Message and optional context
        current_user: Authenticated user

    Returns:
        Dict with detected actions or regular response
    """
    try:
        user_id = current_user["id"]

        # Use action detection service to analyze the message
        # Format it in the same way as vision analysis context
        context_data = {
            "ocr_text": [request.message],  # Put message in ocr_text array
            "meaningful_context": request.message,  # Also in meaningful_context
            "app_name": request.context.get("app_name", "LLM Chat") if request.context else "LLM Chat",
            "window_title": request.context.get("window_title", "") if request.context else "",
            "user_id": user_id
        }

        logger.info(f"🔍 Detecting actions from message: {request.message[:50]}...")

        # Detect actions using analyze_context
        result = action_detection_service.analyze_context(context_data)

        if result and result.get("execution_mode") == "direct":
            # Format as executable suggestion
            action_steps = result.get("action_steps", [])
            logger.info(f"✅ Detected {len(action_steps)} action(s)")
            return {
                "has_actions": True,
                "execution_mode": "direct",
                "action_steps": action_steps,
                "message": result.get("content", {}).get("summary", "I can help you with that. Click Execute to perform the action."),
                "type": "action_suggestion"
            }
        else:
            # No actions detected
            logger.info("ℹ️ No actions detected")
            return {
                "has_actions": False,
                "message": "I don't detect any executable actions in your message. Try asking me to schedule a meeting, send an email, or create a calendar event."
            }

    except Exception as e:
        logger.error(f"❌ Error detecting actions: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to detect actions: {str(e)}"
        )
