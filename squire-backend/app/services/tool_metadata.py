"""
Helpers for exposing tool metadata to other services.
"""

import app.tools  # ensure registrations
from app.tools.formatters import as_action_metadata


def get_tool_metadata():
    """Return canonical tool metadata for consumers (ActionExecutor, APIs, etc.)."""
    return as_action_metadata()

