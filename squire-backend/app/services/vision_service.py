"""
Vision Service

Integrates with Vision AI APIs (GPT-4 Vision and Claude Vision) to analyze screenshots
and extract contextual insights for productivity assistance.
"""

import os
import base64
import anthropic
import openai
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class VisionService:
    def __init__(self):
        self.anthropic_client = None
        self.openai_client = None
        self.default_provider = "anthropic"  # or "openai"

        # Initialize Anthropic (Claude)
        anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
        if anthropic_api_key:
            self.anthropic_client = anthropic.Anthropic(api_key=anthropic_api_key)
            logger.info("✅ Anthropic Claude Vision initialized")
        else:
            logger.warning("⚠️ ANTHROPIC_API_KEY not found")

        # Initialize OpenAI (GPT-4 Vision)
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if openai_api_key:
            self.openai_client = openai.OpenAI(api_key=openai_api_key)
            logger.info("✅ OpenAI GPT-4 Vision initialized")
        else:
            logger.warning("⚠️ OPENAI_API_KEY not found")

        # Set default provider based on what's available
        if self.anthropic_client:
            self.default_provider = "anthropic"
        elif self.openai_client:
            self.default_provider = "openai"
        else:
            logger.error("❌ No vision API keys configured!")

    async def analyze_screenshot(
        self,
        screenshot_data: bytes,
        app_name: str,
        provider: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Analyze a screenshot using Vision AI.

        Args:
            screenshot_data: Raw screenshot bytes (PNG/JPEG)
            app_name: Application name for context
            provider: "anthropic" or "openai" (defaults to configured provider)

        Returns:
            Dict with analysis results:
            {
                "task": "What the user is working on",
                "ui_elements": ["List", "of", "key", "UI", "elements"],
                "context": "Detailed context description",
                "patterns": "Notable workflows or patterns",
                "insights": "Productivity insights",
                "provider": "anthropic/openai",
                "model": "claude-3-5-sonnet-20241022/gpt-4-vision-preview"
            }
        """
        provider = provider or self.default_provider

        try:
            if provider == "anthropic" and self.anthropic_client:
                return await self._analyze_with_claude(screenshot_data, app_name)
            elif provider == "openai" and self.openai_client:
                return await self._analyze_with_gpt4_vision(screenshot_data, app_name)
            else:
                raise Exception(f"Provider '{provider}' not available or not configured")

        except Exception as e:
            logger.error(f"❌ Vision analysis failed: {e}")
            raise

    async def _analyze_with_claude(
        self,
        screenshot_data: bytes,
        app_name: str
    ) -> Dict[str, Any]:
        """Analyze screenshot using Claude Vision"""
        try:
            # Encode screenshot to base64
            screenshot_base64 = base64.b64encode(screenshot_data).decode('utf-8')

            # Build prompt for productivity context extraction
            prompt = self._build_analysis_prompt(app_name)

            # Call Claude Vision API
            message = self.anthropic_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1024,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": screenshot_base64,
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt
                            }
                        ],
                    }
                ],
            )

            # Parse response
            response_text = message.content[0].text

            logger.info(f"✅ Claude Vision analysis complete for {app_name}")

            return {
                "raw_response": response_text,
                "provider": "anthropic",
                "model": "claude-3-5-sonnet-20241022",
                "app_name": app_name,
                **self._parse_analysis_response(response_text)
            }

        except Exception as e:
            logger.error(f"❌ Claude Vision error: {e}")
            raise

    async def _analyze_with_gpt4_vision(
        self,
        screenshot_data: bytes,
        app_name: str
    ) -> Dict[str, Any]:
        """Analyze screenshot using GPT-4 Vision"""
        try:
            # Encode screenshot to base64
            screenshot_base64 = base64.b64encode(screenshot_data).decode('utf-8')

            # Build prompt
            prompt = self._build_analysis_prompt(app_name)

            # Call GPT-4 Vision API
            response = self.openai_client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": prompt
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{screenshot_base64}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=1024
            )

            # Parse response
            response_text = response.choices[0].message.content

            logger.info(f"✅ GPT-4 Vision analysis complete for {app_name}")

            return {
                "raw_response": response_text,
                "provider": "openai",
                "model": "gpt-4-vision-preview",
                "app_name": app_name,
                **self._parse_analysis_response(response_text)
            }

        except Exception as e:
            logger.error(f"❌ GPT-4 Vision error: {e}")
            raise

    def _build_analysis_prompt(self, app_name: str) -> str:
        """Build the analysis prompt for vision AI"""
        return f"""Analyze this screenshot from {app_name} and extract productivity context.

Please provide:

1. **Current Task**: What is the user working on? (1-2 sentences)
2. **UI Elements**: What key UI elements are visible? (list)
3. **Context**: Relevant context for understanding their workflow (2-3 sentences)
4. **Patterns**: Any notable patterns or workflows observed
5. **Insights**: Brief productivity insights or suggestions

Format your response as JSON with these keys:
- task: string
- ui_elements: array of strings
- context: string
- patterns: string
- insights: string

Focus on extracting information that would help provide intelligent productivity assistance."""

    def _parse_analysis_response(self, response_text: str) -> Dict[str, Any]:
        """
        Parse the vision API response.

        Attempts to extract structured data from the response.
        Falls back to raw text if JSON parsing fails.
        """
        import json

        try:
            # Try to parse as JSON
            # Look for JSON block in markdown
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_str = response_text[json_start:json_end].strip()
                parsed = json.loads(json_str)
            elif "{" in response_text and "}" in response_text:
                # Try to extract JSON from response
                json_start = response_text.find("{")
                json_end = response_text.rfind("}") + 1
                json_str = response_text[json_start:json_end]
                parsed = json.loads(json_str)
            else:
                # No JSON found, return structured default
                parsed = {
                    "task": "Unable to parse task",
                    "ui_elements": [],
                    "context": response_text[:200],
                    "patterns": "",
                    "insights": ""
                }

            return {
                "task": parsed.get("task", ""),
                "ui_elements": parsed.get("ui_elements", []),
                "context": parsed.get("context", ""),
                "patterns": parsed.get("patterns", ""),
                "insights": parsed.get("insights", "")
            }

        except Exception as e:
            logger.warning(f"⚠️ Failed to parse vision response as JSON: {e}")
            # Return raw text in structured format
            return {
                "task": "Error parsing response",
                "ui_elements": [],
                "context": response_text[:300] if response_text else "",
                "patterns": "",
                "insights": ""
            }

    def is_available(self, provider: Optional[str] = None) -> bool:
        """Check if vision service is available"""
        if provider == "anthropic":
            return self.anthropic_client is not None
        elif provider == "openai":
            return self.openai_client is not None
        else:
            return self.anthropic_client is not None or self.openai_client is not None


# Singleton instance
vision_service = VisionService()
