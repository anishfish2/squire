"""
LLM Service for handling chat completions with multiple providers.
Supports OpenAI, Anthropic, and Google AI.
"""

import os
import json
from typing import AsyncGenerator, List, Dict, Any, Optional
from openai import AsyncOpenAI
import anthropic
import logging

logger = logging.getLogger(__name__)


class LLMProvider:
    """Base class for LLM providers."""

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        model: str,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion."""
        raise NotImplementedError


class OpenAIProvider(LLMProvider):
    """OpenAI provider for GPT models."""

    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key)

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        model: str,
        **kwargs
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream chat completion from OpenAI."""
        try:
            stream = await self.client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                **kwargs
            )

            chunk_count = 0
            async for chunk in stream:
                chunk_count += 1
                delta = chunk.choices[0].delta

                # Debug: Log what we receive
                print(f"📦 OpenAI chunk {chunk_count}: content={bool(delta.content)}, tool_calls={bool(hasattr(delta, 'tool_calls') and delta.tool_calls)}", flush=True)

                # Yield text content
                if delta.content:
                    print(f"   💬 Content: {delta.content[:50]}", flush=True)
                    yield {"content": delta.content}

                # Yield function/tool calls
                if hasattr(delta, 'tool_calls') and delta.tool_calls:
                    for tool_call in delta.tool_calls:
                        tool_call_data = {
                            "id": tool_call.id if tool_call.id else None,
                            "name": tool_call.function.name if hasattr(tool_call.function, 'name') else None,
                            "arguments": tool_call.function.arguments if hasattr(tool_call.function, 'arguments') else None
                        }
                        print(f"🔧 OpenAI tool_call chunk: id={tool_call_data['id']}, name={tool_call_data['name']}, args={repr(tool_call_data['arguments'][:100] if tool_call_data['arguments'] else 'EMPTY')}", flush=True)
                        yield {"tool_call": tool_call_data}

            print(f"✅ OpenAI stream completed after {chunk_count} chunks", flush=True)

        except Exception as e:
            logger.error(f"OpenAI streaming error: {e}")
            raise


class AnthropicProvider(LLMProvider):
    """Anthropic provider for Claude models."""

    def __init__(self, api_key: str):
        self.client = anthropic.AsyncAnthropic(api_key=api_key)

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        model: str,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion from Anthropic."""
        try:
            # Convert OpenAI format to Anthropic format
            system_messages = [m for m in messages if m['role'] == 'system']
            conversation_messages = [m for m in messages if m['role'] != 'system']

            # Map model names to Anthropic format
            model_mapping = {
                'claude-3-opus': 'claude-3-opus-20240229',
                'claude-3-sonnet': 'claude-3-sonnet-20240229',
                'claude-3-haiku': 'claude-3-haiku-20240307',
            }

            anthropic_model = model_mapping.get(model, model)

            # Build parameters
            params = {
                'model': anthropic_model,
                'messages': conversation_messages,
                'max_tokens': kwargs.get('max_tokens', 4096),
            }

            # Only add system if we have system messages
            if system_messages:
                params['system'] = system_messages[0]['content']

            async with self.client.messages.stream(**params) as stream:
                async for text in stream.text_stream:
                    yield text

        except Exception as e:
            logger.error(f"Anthropic streaming error: {e}")
            raise


class GoogleProvider(LLMProvider):
    """Google AI provider for Gemini models."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        # Google AI implementation would go here
        # For now, this is a placeholder

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        model: str,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion from Google AI."""
        # Placeholder - implement when Google AI SDK is added
        yield "Google AI provider not yet implemented. Please use OpenAI or Anthropic models."


class LLMService:
    """Main service for handling LLM chat completions."""

    def __init__(self):
        self.providers = {}
        self._initialize_providers()

    def _initialize_providers(self):
        """Initialize available LLM providers based on API keys."""
        # OpenAI
        openai_key = os.getenv('OPENAI_API_KEY')
        if openai_key:
            self.providers['openai'] = OpenAIProvider(openai_key)
            logger.info("OpenAI provider initialized")
        else:
            logger.warning("OPENAI_API_KEY not found in environment")

        # Anthropic
        anthropic_key = os.getenv('ANTHROPIC_API_KEY')
        if anthropic_key:
            self.providers['anthropic'] = AnthropicProvider(anthropic_key)
            logger.info("Anthropic provider initialized")
        else:
            logger.warning("ANTHROPIC_API_KEY not found in environment")

        # Google
        google_key = os.getenv('GOOGLE_API_KEY')
        if google_key:
            self.providers['google'] = GoogleProvider(google_key)
            logger.info("Google AI provider initialized")
        else:
            logger.warning("GOOGLE_API_KEY not found in environment")

    def _get_provider(self, model: str) -> tuple[LLMProvider, str]:
        """Get the appropriate provider for a given model."""
        # Map models to providers
        if model.startswith('gpt'):
            provider_name = 'openai'
        elif model.startswith('claude'):
            provider_name = 'anthropic'
        elif model.startswith('gemini'):
            provider_name = 'google'
        else:
            raise ValueError(f"Unknown model: {model}")

        provider = self.providers.get(provider_name)
        if not provider:
            available = list(self.providers.keys())
            raise ValueError(
                f"Provider '{provider_name}' for model '{model}' not available. "
                f"Available providers: {available}. "
                f"Check that your API key is set in .env file."
            )

        return provider, provider_name

    async def stream_chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: str,
        **kwargs
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream chat completion from the appropriate provider.

        Args:
            messages: List of message dictionaries with 'role' and 'content'
            model: Model identifier (e.g., 'gpt-4', 'claude-3-opus')
            **kwargs: Additional parameters for the provider

        Yields:
            Dict with 'content' or 'tool_call' keys containing the streamed data
        """
        try:
            provider, provider_name = self._get_provider(model)
            logger.info(f"Streaming chat with {provider_name} model {model}")

            async for chunk in provider.stream_chat(messages, model, **kwargs):
                # OpenAI provider yields structured dicts, Anthropic yields strings
                if isinstance(chunk, dict):
                    # Pass through structured data from OpenAI (content and tool calls)
                    yield chunk
                else:
                    # Wrap string data from Anthropic/Google
                    yield {'content': chunk}

            # Signal completion
            yield {'done': True}

        except Exception as e:
            logger.error(f"Error in stream_chat_completion: {e}")
            yield {'error': str(e)}


# Global instance
llm_service = LLMService()
