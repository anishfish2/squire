"""
Built-in Gmail tool definitions.
"""

from app.tools.definitions import (
    ToolCategory,
    ToolDefinition,
    ToolParameter,
    ToolAuthRequirement,
)
from app.tools.registry import registry

registry.register(
    ToolDefinition(
        name="gmail_create_draft",
        description="Create an email draft in Gmail",
        category=ToolCategory.EMAIL,
        parameters=[
            ToolParameter(
                name="to",
                type="string",
                description="Recipient email address",
                required=True,
            ),
            ToolParameter(
                name="subject",
                type="string",
                description="Email subject",
                required=True,
            ),
            ToolParameter(
                name="body",
                type="string",
                description="Email body content",
                required=True,
            ),
            ToolParameter(
                name="cc",
                type="array",
                description="Optional CC recipients",
                items={"type": "string"},
            ),
            ToolParameter(
                name="bcc",
                type="array",
                description="Optional BCC recipients",
                items={"type": "string"},
            ),
            ToolParameter(
                name="html",
                type="boolean",
                description="Whether the body is HTML",
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/gmail.compose",
            ],
        ),
    )
)

registry.register(
    ToolDefinition(
        name="gmail_send",
        description="Send an email via Gmail",
        category=ToolCategory.EMAIL,
        parameters=[
            ToolParameter(
                name="to",
                type="string",
                description="Recipient email address",
                required=True,
            ),
            ToolParameter(
                name="subject",
                type="string",
                description="Email subject",
                required=True,
            ),
            ToolParameter(
                name="body",
                type="string",
                description="Email body content",
                required=True,
            ),
            ToolParameter(
                name="cc",
                type="array",
                description="Optional CC recipients",
                items={"type": "string"},
            ),
            ToolParameter(
                name="bcc",
                type="array",
                description="Optional BCC recipients",
                items={"type": "string"},
            ),
            ToolParameter(
                name="html",
                type="boolean",
                description="Whether the body is HTML",
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/gmail.send",
            ],
        ),
    )
)

registry.register(
    ToolDefinition(
        name="gmail_search",
        description="Search the user's Gmail inbox using Gmail search syntax",
        category=ToolCategory.EMAIL,
        parameters=[
            ToolParameter(
                name="query",
                type="string",
                description="Search query (e.g., 'from:alice@example.com subject:Invoice')",
                required=True,
            ),
            ToolParameter(
                name="max_results",
                type="integer",
                description="Maximum number of emails to return",
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/gmail.readonly",
            ],
        ),
    )
)
