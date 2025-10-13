"""
Canonical tool definition models.

These Pydantic classes capture the metadata required by different consumers:
- ActionExecutor / agents
- LLM router (OpenAI/Anthropic function/tool schemas)
- Future suggestion engine + MCP integrations
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator


class ToolParameter(BaseModel):
    """Describes a single parameter for a tool."""

    name: str
    type: str = Field(..., description="JSON schema-compatible type (string, integer, object, etc.)")
    description: str = ""
    required: bool = False
    enum: Optional[List[Any]] = None
    properties: Optional[Dict[str, Any]] = None  # For object/array types
    items: Optional[Dict[str, Any]] = None       # For array element schema


class ToolCategory(str, Enum):
    CALENDAR = "calendar"
    EMAIL = "email"
    SEARCH = "search"
    AUTOMATION = "automation"
    OTHER = "other"


class ToolCapabilityFlags(BaseModel):
    """Optional capability flags that describe runtime behavior."""

    supports_streaming: bool = False
    requires_auth: bool = True
    is_expensive: bool = False
    is_idempotent: bool = False


class ToolAuthRequirement(BaseModel):
    """Describes the authentication scope/provider requirements for a tool."""

    provider: str = Field(..., description="e.g., google, gmail, notion")
    scopes: List[str] = Field(default_factory=list)


class ToolVersion(BaseModel):
    """Version metadata to support future compatibility."""

    version: str = "1.0.0"
    changelog: Optional[str] = None


class ToolDefinition(BaseModel):
    """
    Canonical tool metadata.

    This is the single source of truth for tool schema across the backend.
    """

    name: str
    description: str
    category: ToolCategory = ToolCategory.OTHER
    parameters: List[ToolParameter] = Field(default_factory=list)
    returns: Optional[Dict[str, Any]] = None  # Schema for successful payload
    examples: Optional[List[Dict[str, Any]]] = None
    capability_flags: ToolCapabilityFlags = Field(default_factory=ToolCapabilityFlags)
    auth: Optional[ToolAuthRequirement] = None
    version: ToolVersion = Field(default_factory=ToolVersion)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @property
    def required_parameters(self) -> List[str]:
        """Convenience access to required parameter names."""
        return [param.name for param in self.parameters if param.required]

    def json_schema(self) -> Dict[str, Any]:
        """
        Render parameters as a JSON schema object suitable for OpenAI function calling.
        """
        properties = {}
        required = []

        for param in self.parameters:
            schema: Dict[str, Any] = {
                "type": param.type,
            }
            if param.description:
                schema["description"] = param.description
            if param.enum:
                schema["enum"] = param.enum
            if param.properties:
                schema["properties"] = param.properties
            if param.items:
                schema["items"] = param.items

            properties[param.name] = schema

            if param.required:
                required.append(param.name)

        return {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        }

    @model_validator(mode="after")
    def validate_parameters_unique(cls, values: "ToolDefinition") -> "ToolDefinition":
        params = values.parameters or []
        names = [p.name for p in params]
        if len(names) != len(set(names)):
            duplicates = {name for name in names if names.count(name) > 1}
            raise ValueError(f"Duplicate parameter names detected: {duplicates}")
        return values
