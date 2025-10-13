"""
Tool registry package.

Provides shared definitions and registration utilities so that tools can be
declared once and consumed across the backend (LLM router, action executor,
future MCP integrations).
"""

# Import built-in tool definitions so they register on package import.
from . import builtin_calendar  # noqa: F401
from . import builtin_gmail  # noqa: F401

__all__ = [
    "builtin_calendar",
    "builtin_gmail",
]
