"""
In-memory tool registry with decorator-based registration.
"""

from __future__ import annotations

from typing import Callable, Dict, Iterable, Optional

from .definitions import ToolDefinition


class ToolRegistry:
    """Simple in-memory registry for tool definitions."""

    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition) -> None:
        if definition.name in self._tools:
            # For now, allow override but log warning
            # TODO: replace with structured logging once we add logger
            print(f"⚠️ [ToolRegistry] Overwriting tool definition for '{definition.name}'")
        self._tools[definition.name] = definition

    def get(self, name: str) -> Optional[ToolDefinition]:
        return self._tools.get(name)

    def all(self) -> Iterable[ToolDefinition]:
        return self._tools.values()

    def names(self) -> Iterable[str]:
        return self._tools.keys()


registry = ToolRegistry()


def tool(definition: ToolDefinition) -> Callable:
    """
    Decorator to register a tool definition alongside its executor.

    Example:

    ```
    @tool(ToolDefinition(...))
    async def run_calendar_update(context, params):
        ...
    ```
    """

    def decorator(func: Callable):
        registry.register(definition)
        func.__tool_definition__ = definition
        return func

    return decorator

