"""
Built-in Google Calendar tool definitions.

These are registered at import time so consumers can fetch canonical metadata
from the registry instead of duplicating schemas.
"""

from app.tools.definitions import (
    ToolCategory,
    ToolDefinition,
    ToolParameter,
    ToolAuthRequirement,
)
from app.tools.registry import registry

# Note: execution functions are the existing calendar agent methods.
# Here we only register metadata.

registry.register(
    ToolDefinition(
        name="calendar_create_event",
        description="Create a calendar event on the user's Google Calendar",
        category=ToolCategory.CALENDAR,
        parameters=[
            ToolParameter(
                name="title",
                type="string",
                description="The title/summary of the event",
                required=True,
            ),
            ToolParameter(
                name="start",
                type="string",
                description="Start time in ISO 8601 format (e.g., 2025-10-11T14:00:00Z)",
                required=True,
            ),
            ToolParameter(
                name="end",
                type="string",
                description="End time in ISO 8601 format (optional, defaults to 1 hour after start)",
            ),
            ToolParameter(
                name="description",
                type="string",
                description="Event description or notes",
            ),
            ToolParameter(
                name="location",
                type="string",
                description="Event location",
            ),
            ToolParameter(
                name="attendees",
                type="array",
                description="Optional attendees email addresses",
                items={"type": "string"},
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/calendar",
                "https://www.googleapis.com/auth/calendar.events",
            ],
        ),
    )
)

registry.register(
    ToolDefinition(
        name="calendar_search_events",
        description="Search for calendar events by title and/or date range. Use this BEFORE updating events to find the event ID.",
        category=ToolCategory.CALENDAR,
        parameters=[
            ToolParameter(
                name="query",
                type="string",
                description="Search query to match against event titles (e.g., 'climbing', 'standup')",
                required=True,
            ),
            ToolParameter(
                name="start_date",
                type="string",
                description="Start of date range to search (ISO 8601 format, e.g., 2025-10-11T00:00:00Z). Defaults to today.",
            ),
            ToolParameter(
                name="end_date",
                type="string",
                description="End of date range to search (ISO 8601 format). Defaults to 7 days from start_date.",
            ),
            ToolParameter(
                name="max_results",
                type="integer",
                description="Maximum number of events to return (default: 10)",
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/calendar",
                "https://www.googleapis.com/auth/calendar.events.readonly",
            ],
        ),
    )
)

registry.register(
    ToolDefinition(
        name="calendar_update_event",
        description="Update an existing calendar event. You must search for the event first using calendar_search_events to get the event_id.",
        category=ToolCategory.CALENDAR,
        parameters=[
            ToolParameter(
                name="event_id",
                type="string",
                description="The ID of the event to update (obtained from calendar_search_events)",
                required=True,
            ),
            ToolParameter(
                name="title",
                type="string",
                description="New event title",
            ),
            ToolParameter(
                name="start",
                type="string",
                description="New start time in ISO 8601 format",
            ),
            ToolParameter(
                name="end",
                type="string",
                description="New end time in ISO 8601 format",
            ),
            ToolParameter(
                name="description",
                type="string",
                description="New event description",
            ),
            ToolParameter(
                name="location",
                type="string",
                description="New event location",
            ),
            ToolParameter(
                name="attendees",
                type="array",
                description="Updated list of attendee email addresses",
                items={"type": "string"},
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/calendar",
                "https://www.googleapis.com/auth/calendar.events",
            ],
        ),
    )
)

registry.register(
    ToolDefinition(
        name="calendar_list_upcoming",
        description="List upcoming calendar events in the next N days",
        category=ToolCategory.CALENDAR,
        parameters=[
            ToolParameter(
                name="days",
                type="integer",
                description="Number of days to look ahead (default: 7)",
            ),
            ToolParameter(
                name="max_results",
                type="integer",
                description="Maximum number of events to return (default: 10)",
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/calendar.readonly",
            ],
        ),
    )
)

registry.register(
    ToolDefinition(
        name="calendar_create_recurring",
        description="Create a recurring calendar event with recurrence rules",
        category=ToolCategory.CALENDAR,
        parameters=[
            ToolParameter(
                name="title",
                type="string",
                description="Event title",
                required=True,
            ),
            ToolParameter(
                name="start",
                type="string",
                description="First occurrence start time in ISO 8601 format",
                required=True,
            ),
            ToolParameter(
                name="end",
                type="string",
                description="First occurrence end time in ISO 8601 format",
            ),
            ToolParameter(
                name="recurrence_rule",
                type="string",
                description="RRULE format string (e.g., 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR')",
                required=True,
            ),
            ToolParameter(
                name="description",
                type="string",
                description="Event description",
            ),
            ToolParameter(
                name="location",
                type="string",
                description="Event location",
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/calendar",
                "https://www.googleapis.com/auth/calendar.events",
            ],
        ),
    )
)

registry.register(
    ToolDefinition(
        name="calendar_add_meet_link",
        description="Add a Google Meet video conference link to an existing calendar event. You must search for the event first to get the event_id.",
        category=ToolCategory.CALENDAR,
        parameters=[
            ToolParameter(
                name="event_id",
                type="string",
                description="The ID of the event to add Google Meet link to (obtained from calendar_search_events)",
                required=True,
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/calendar",
                "https://www.googleapis.com/auth/calendar.events",
            ],
        ),
    )
)

registry.register(
    ToolDefinition(
        name="calendar_set_reminders",
        description="Set custom reminders for a calendar event. You must search for the event first to get the event_id.",
        category=ToolCategory.CALENDAR,
        parameters=[
            ToolParameter(
                name="event_id",
                type="string",
                description="The ID of the event to set reminders for (obtained from calendar_search_events)",
                required=True,
            ),
            ToolParameter(
                name="reminders",
                type="array",
                description="Array of reminder objects (each requires method and minutes)",
                required=True,
                items={
                    "type": "object",
                    "properties": {
                        "method": {
                            "type": "string",
                            "enum": ["email", "popup"],
                            "description": "Reminder delivery method",
                        },
                        "minutes": {
                            "type": "integer",
                            "description": "Minutes before event to trigger reminder",
                        },
                    },
                    "required": ["method", "minutes"],
                },
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/calendar",
                "https://www.googleapis.com/auth/calendar.events",
            ],
        ),
    )
)

registry.register(
    ToolDefinition(
        name="calendar_add_attendees",
        description="Add attendees/guests to an existing calendar event. You must search for the event first to get the event_id.",
        category=ToolCategory.CALENDAR,
        parameters=[
            ToolParameter(
                name="event_id",
                type="string",
                description="The ID of the event to add attendees to (obtained from calendar_search_events)",
                required=True,
            ),
            ToolParameter(
                name="attendees",
                type="array",
                description="Array of attendee email addresses to invite",
                required=True,
                items={"type": "string"},
            ),
        ],
        auth=ToolAuthRequirement(
            provider="google",
            scopes=[
                "https://www.googleapis.com/auth/calendar",
                "https://www.googleapis.com/auth/calendar.events",
            ],
        ),
    )
)

