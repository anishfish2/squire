"""
Utilities for converting ToolDefinition data for different consumers.
"""

from __future__ import annotations

from typing import Dict, List

from .registry import registry


def as_openai_functions() -> List[Dict]:
    """Return tools in OpenAI function-call format."""
    tools = []
    for tool in sorted(registry.all(), key=lambda t: t.name):
        tools.append({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.json_schema(),
            }
        })
    return tools


def as_action_metadata() -> Dict[str, Dict]:
    """
    Return tool metadata for action execution routing.

    Includes category, required params, and auth scopes, which can be used by
    ActionExecutor to enforce requirements or by the frontend to display
    contextual information.
    """
    metadata = {}
    for tool in registry.all():
        metadata[tool.name] = {
            "description": tool.description,
            "category": tool.category.value,
            "required_parameters": tool.required_parameters,
            "auth": tool.auth.model_dump() if tool.auth else None,
            "capabilities": tool.capability_flags.model_dump(),
        }
    return metadata

