"""
Google Calendar Agent
Handles calendar event operations
"""
from typing import Dict, Any
from datetime import datetime, timedelta
import os
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.agents.base_agent import BaseAgent, ActionResult, AuthenticationError, ValidationError, ExecutionError


class CalendarAgent(BaseAgent):
    """Agent for Google Calendar operations"""

    def __init__(self, user_id: str, credentials: Dict[str, Any]):
        super().__init__(user_id, credentials)
        self.service = None

        if credentials:
            try:
                # Build Google API credentials
                creds = Credentials(
                    token=credentials.get("access_token"),
                    refresh_token=credentials.get("refresh_token"),
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=os.getenv("GOOGLE_CLIENT_ID"),
                    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
                    scopes=credentials.get("scopes", [
                        "https://www.googleapis.com/auth/calendar",
                        "https://www.googleapis.com/auth/calendar.events"
                    ])
                )

                # Build Calendar API service
                self.service = build('calendar', 'v3', credentials=creds)
                self.log("Calendar service initialized")

            except Exception as e:
                self.log(f"Failed to initialize Calendar service: {e}", "error")
                raise AuthenticationError(f"Failed to authenticate with Google Calendar: {e}")

    async def execute(self, action_type: str, params: Dict[str, Any]) -> ActionResult:
        """Execute a calendar action"""

        if not self.service:
            return ActionResult(
                success=False,
                error="Calendar service not initialized. Please connect your Google account."
            )

        try:
            # Route to appropriate method
            if action_type == "calendar_create_event":
                return await self.create_event(**params)
            elif action_type == "calendar_search_events":
                return await self.search_events(**params)
            elif action_type == "calendar_update_event":
                return await self.update_event(**params)
            elif action_type == "calendar_delete_event":
                return await self.delete_event(**params)
            elif action_type == "calendar_get_availability":
                return await self.get_availability(**params)
            elif action_type == "calendar_list_upcoming":
                return await self.list_upcoming_events(**params)
            elif action_type == "calendar_create_recurring":
                return await self.create_recurring_event(**params)
            elif action_type == "calendar_add_meet_link":
                return await self.add_google_meet_link(**params)
            elif action_type == "calendar_set_reminders":
                return await self.set_reminders(**params)
            elif action_type == "calendar_add_attendees":
                return await self.add_attendees(**params)
            else:
                return ActionResult(
                    success=False,
                    error=f"Unknown action type: {action_type}"
                )

        except Exception as e:
            self.log(f"Error executing {action_type}: {e}", "error")
            return ActionResult(success=False, error=str(e))

    async def create_event(
        self,
        title: str,
        start: str,
        end: str = None,
        description: str = "",
        location: str = "",
        attendees: list = None,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """
        Create a calendar event

        Args:
            title: Event title
            start: Start time (ISO 8601 format)
            end: End time (ISO 8601 format). If not provided, defaults to 1 hour after start
            description: Event description
            location: Event location
            attendees: List of email addresses
            calendar_id: Calendar ID (default: 'primary')

        Returns:
            ActionResult with event data
        """
        try:
            # Parse start time and extract timezone
            start_dt = datetime.fromisoformat(start.replace('Z', '+00:00'))

            # Extract timezone from the datetime object
            if start_dt.tzinfo is not None:
                # Get timezone name (e.g., 'America/Los_Angeles' or use offset)
                timezone_name = str(start_dt.tzinfo)
                if timezone_name.startswith('UTC'):
                    # If it's a UTC offset like UTC-08:00, extract it
                    timezone_name = 'Etc/GMT' + timezone_name[3:]  # Convert UTC-08:00 to Etc/GMT+8 (note: reversed!)
            else:
                # No timezone info, use UTC as fallback
                timezone_name = 'UTC'

            # If no end time, default to 1 hour after start
            if not end:
                end_dt = start_dt + timedelta(hours=1)
                end = end_dt.isoformat()

            # Build event body - use the datetime strings as-is, Google will parse the timezone
            event = {
                'summary': title,
                'description': description,
                'start': {
                    'dateTime': start,
                },
                'end': {
                    'dateTime': end,
                },
            }

            if location:
                event['location'] = location

            if attendees:
                event['attendees'] = [{'email': email} for email in attendees]

            # Create event
            created_event = self.service.events().insert(
                calendarId=calendar_id,
                body=event
            ).execute()

            self.log(f"Created calendar event: {created_event.get('id')}")

            return ActionResult(
                success=True,
                data={
                    "event_id": created_event.get('id'),
                    "title": created_event.get('summary'),
                    "start": created_event.get('start', {}).get('dateTime'),
                    "end": created_event.get('end', {}).get('dateTime'),
                    "html_link": created_event.get('htmlLink'),
                    "status": created_event.get('status')
                },
                metadata={
                    "calendar_id": calendar_id
                }
            )

        except HttpError as e:
            self.log(f"Google API error: {e}", "error")
            return ActionResult(
                success=False,
                error=f"Google Calendar API error: {e}"
            )
        except Exception as e:
            self.log(f"Error creating event: {e}", "error")
            return ActionResult(success=False, error=str(e))

    async def search_events(
        self,
        query: str,
        start_date: str = None,
        end_date: str = None,
        max_results: int = 10,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """
        Search for calendar events by title and date range

        Args:
            query: Search query to match against event titles
            start_date: Start of date range (ISO 8601). Defaults to now.
            end_date: End of date range (ISO 8601). Defaults to 7 days from start.
            max_results: Maximum number of results (default: 10)
            calendar_id: Calendar ID (default: 'primary')

        Returns:
            ActionResult with list of matching events
        """
        try:
            # Helper function to normalize date strings to RFC3339 format
            def normalize_date(date_str: str) -> str:
                """Normalize various date formats to RFC3339 (required by Google Calendar API)"""
                if not date_str:
                    return None

                try:
                    # Preprocess common malformations
                    # Fix: "2025-10-13-07:00" -> "2025-10-13T07:00:00"
                    # This handles cases where '-' is used instead of 'T' as date/time separator
                    import re
                    # Match pattern: YYYY-MM-DD-HH:MM (without seconds)
                    malformed_pattern = r'^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$'
                    match = re.match(malformed_pattern, date_str)
                    if match:
                        # Replace the third '-' with 'T' and add seconds
                        date_str = f"{match.group(1)}T{match.group(2)}:00"
                        self.log(f"Fixed malformed date: {date_str}")
                    else:
                        # Also handle if it has seconds: YYYY-MM-DD-HH:MM:SS
                        malformed_pattern_with_secs = r'^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2}:\d{2})'
                        match_secs = re.match(malformed_pattern_with_secs, date_str)
                        if match_secs:
                            date_str = f"{match_secs.group(1)}T{match_secs.group(2)}"
                            self.log(f"Fixed malformed date separator: {date_str}")

                    # Also handle dates with correct 'T' but missing seconds
                    # "2025-10-13T07:00" -> "2025-10-13T07:00:00"
                    if re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$', date_str):
                        date_str += ':00'
                        self.log(f"Added missing seconds: {date_str}")

                    # Replace 'Z' with '+00:00' for parsing
                    normalized = date_str.replace('Z', '+00:00')

                    # Try to parse as ISO format
                    dt = datetime.fromisoformat(normalized)

                    # Return in RFC3339 format with 'Z' for UTC
                    if dt.tzinfo is None:
                        # No timezone, assume UTC
                        return dt.isoformat() + 'Z'
                    elif dt.utcoffset().total_seconds() == 0:
                        # Already UTC
                        return dt.isoformat().replace('+00:00', 'Z')
                    else:
                        # Has timezone offset, keep it
                        return dt.isoformat()
                except (ValueError, AttributeError) as e:
                    # If parsing fails, log and return None
                    self.log(f"Failed to parse date '{date_str}': {e}", "error")
                    return None

            # Default to searching from now
            if not start_date:
                start_dt = datetime.now()
                start_date = start_dt.isoformat() + 'Z'
            else:
                # Normalize the provided start_date
                start_date = normalize_date(start_date)
                if not start_date:
                    return ActionResult(
                        success=False,
                        error="Invalid start_date format. Please use ISO 8601 format (e.g., 2025-10-13T07:00:00Z)"
                    )

            # Default to 7 days from start
            if not end_date:
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                end_dt = start_dt + timedelta(days=7)
                end_date = end_dt.isoformat().replace('+00:00', 'Z')
            else:
                # Normalize the provided end_date
                end_date = normalize_date(end_date)
                if not end_date:
                    return ActionResult(
                        success=False,
                        error="Invalid end_date format. Please use ISO 8601 format (e.g., 2025-10-13T07:00:00Z)"
                    )

            # If searching within same day, expand to full day
            start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))

            if start_dt.date() == end_dt.date():
                # Set to beginning and end of day
                start_date = start_dt.replace(hour=0, minute=0, second=0, microsecond=0).isoformat() + 'Z'
                end_date = end_dt.replace(hour=23, minute=59, second=59, microsecond=999999).isoformat() + 'Z'
                self.log(f"Expanded single-day search to full day: {start_date} to {end_date}")

            # Search for events - note: Google Calendar's 'q' parameter is case-insensitive by default
            events_result = self.service.events().list(
                calendarId=calendar_id,
                timeMin=start_date,
                timeMax=end_date,
                maxResults=max_results * 2,  # Get more results to filter locally if needed
                singleEvents=True,
                orderBy='startTime',
                q=query if query else None  # Don't pass empty query
            ).execute()

            events = events_result.get('items', [])

            # If we have a query, do additional local filtering for better matching
            if query:
                query_lower = query.lower()
                filtered_events = []
                for event in events:
                    event_title = (event.get('summary') or '').lower()
                    event_desc = (event.get('description') or '').lower()
                    event_location = (event.get('location') or '').lower()

                    # Check if query matches any part of the event
                    if (query_lower in event_title or
                        query_lower in event_desc or
                        query_lower in event_location or
                        event_title.startswith(query_lower) or
                        any(word.startswith(query_lower) for word in event_title.split())):
                        filtered_events.append(event)

                # Use filtered results if we found matches
                if filtered_events:
                    events = filtered_events
                    self.log(f"Local filtering matched {len(filtered_events)} events for '{query}'")

            # Format results
            formatted_events = []
            print(f"\n🔍 [TIMEZONE DEBUG] search_events results for query '{query}':")
            for idx, event in enumerate(events[:max_results]):  # Limit to requested max_results
                event_start = event.get('start', {}).get('dateTime') or event.get('start', {}).get('date')
                event_end = event.get('end', {}).get('dateTime') or event.get('end', {}).get('date')

                print(f"   Event {idx + 1}: \"{event.get('summary')}\"")
                print(f"      Start: {event_start} ← Google Calendar returned this")
                print(f"      End: {event_end} ← Google Calendar returned this")
                print(f"      Event ID: {event.get('id')}")

                formatted_events.append({
                    "event_id": event.get('id'),
                    "title": event.get('summary'),
                    "start": event_start,
                    "end": event_end,
                    "description": event.get('description', ''),
                    "location": event.get('location', ''),
                    "html_link": event.get('htmlLink')
                })
            print()

            self.log(f"Found {len(formatted_events)} events matching '{query}'")

            return ActionResult(
                success=True,
                data={
                    "events": formatted_events,
                    "count": len(formatted_events),
                    "query": query
                }
            )

        except HttpError as e:
            self.log(f"Google API error: {e}", "error")
            return ActionResult(
                success=False,
                error=f"Google Calendar API error: {e}"
            )
        except Exception as e:
            self.log(f"Error searching events: {e}", "error")
            return ActionResult(success=False, error=str(e))

    async def update_event(
        self,
        event_id: str,
        title: str = None,
        start: str = None,
        end: str = None,
        description: str = None,
        location: str = None,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """Update an existing calendar event"""
        try:
            # Get existing event
            event = self.service.events().get(
                calendarId=calendar_id,
                eventId=event_id
            ).execute()

            print(f"\n🔍 [TIMEZONE DEBUG] update_event called:")
            print(f"   Event ID: {event_id}")
            print(f"   Current event start: {event.get('start', {}).get('dateTime', 'N/A')} ← Current time in Google Calendar")
            print(f"   Current event end: {event.get('end', {}).get('dateTime', 'N/A')} ← Current time in Google Calendar")
            print(f"   New start parameter: {start} ← What we want to change it to")
            print(f"   New end parameter: {end} ← What we want to change it to")

            # Update fields
            if title:
                event['summary'] = title
            if description:
                event['description'] = description
            if location:
                event['location'] = location
            if start:
                # Don't override timezone - let Google Calendar parse it from the ISO string
                event['start'] = {'dateTime': start}
                print(f"   Setting start to: {start} ← Sending this to Google Calendar")
            if end:
                # Don't override timezone - let Google Calendar parse it from the ISO string
                event['end'] = {'dateTime': end}
                print(f"   Setting end to: {end} ← Sending this to Google Calendar")

            # Update event
            updated_event = self.service.events().update(
                calendarId=calendar_id,
                eventId=event_id,
                body=event
            ).execute()

            self.log(f"Updated calendar event: {event_id}")

            result_start = updated_event.get('start', {}).get('dateTime')
            result_end = updated_event.get('end', {}).get('dateTime')

            print(f"   ✅ Updated event successfully!")
            print(f"   Result start from Google: {result_start} ← What Google Calendar returned")
            print(f"   Result end from Google: {result_end} ← What Google Calendar returned\n")

            return ActionResult(
                success=True,
                data={
                    "event_id": updated_event.get('id'),
                    "title": updated_event.get('summary'),
                    "start": result_start,
                    "end": result_end,
                    "html_link": updated_event.get('htmlLink')
                }
            )

        except HttpError as e:
            # Provide more helpful error messages for common cases
            if e.resp.status == 404:
                self.log(f"Event not found: {event_id}", "error")
                return ActionResult(
                    success=False,
                    error=f"Event with ID '{event_id}' not found. The event may have been deleted or the ID may be incorrect. Please search for the event first using calendar_search_events to get the correct event ID."
                )
            elif e.resp.status == 403:
                self.log(f"Permission denied for event: {event_id}", "error")
                return ActionResult(
                    success=False,
                    error=f"Permission denied. You may not have access to this event or calendar."
                )
            else:
                self.log(f"Google API error: {e}", "error")
                return ActionResult(
                    success=False,
                    error=f"Google Calendar API error: {e}"
                )
        except Exception as e:
            self.log(f"Unexpected error: {e}", "error")
            return ActionResult(success=False, error=str(e))

    async def delete_event(
        self,
        event_id: str,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """Delete a calendar event"""
        try:
            self.service.events().delete(
                calendarId=calendar_id,
                eventId=event_id
            ).execute()

            self.log(f"Deleted calendar event: {event_id}")

            return ActionResult(
                success=True,
                data={"event_id": event_id, "deleted": True}
            )

        except HttpError as e:
            if e.resp.status == 404:
                self.log(f"Event not found: {event_id}", "error")
                return ActionResult(
                    success=False,
                    error=f"Event with ID '{event_id}' not found. The event may have already been deleted or the ID may be incorrect."
                )
            else:
                self.log(f"Google API error: {e}", "error")
                return ActionResult(
                    success=False,
                    error=f"Google Calendar API error: {e}"
                )
        except Exception as e:
            return ActionResult(success=False, error=str(e))

    async def get_availability(
        self,
        date: str,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """Get user's availability for a specific date"""
        try:
            # Parse date
            date_dt = datetime.fromisoformat(date.replace('Z', '+00:00'))
            start_of_day = date_dt.replace(hour=0, minute=0, second=0, microsecond=0)
            end_of_day = date_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

            # Get events for the day
            events_result = self.service.events().list(
                calendarId=calendar_id,
                timeMin=start_of_day.isoformat(),
                timeMax=end_of_day.isoformat(),
                singleEvents=True,
                orderBy='startTime'
            ).execute()

            events = events_result.get('items', [])

            # Extract busy times
            busy_times = []
            for event in events:
                start = event.get('start', {}).get('dateTime', event.get('start', {}).get('date'))
                end = event.get('end', {}).get('dateTime', event.get('end', {}).get('date'))

                busy_times.append({
                    "start": start,
                    "end": end,
                    "title": event.get('summary', 'Busy')
                })

            self.log(f"Retrieved {len(busy_times)} busy times for {date}")

            return ActionResult(
                success=True,
                data={
                    "date": date,
                    "busy_times": busy_times,
                    "total_events": len(busy_times)
                }
            )

        except HttpError as e:
            return ActionResult(
                success=False,
                error=f"Google Calendar API error: {e}"
            )
        except Exception as e:
            return ActionResult(success=False, error=str(e))

    async def list_upcoming_events(
        self,
        days: int = 7,
        max_results: int = 10,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """
        List upcoming events

        Args:
            days: Number of days ahead to look (default: 7)
            max_results: Maximum number of events to return (default: 10)
            calendar_id: Calendar ID (default: 'primary')

        Returns:
            ActionResult with list of upcoming events
        """
        try:
            # Get current time and calculate end time
            now = datetime.now()
            time_min = now.isoformat() + 'Z'
            time_max = (now + timedelta(days=days)).isoformat() + 'Z'

            # Get upcoming events
            events_result = self.service.events().list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy='startTime'
            ).execute()

            events = events_result.get('items', [])

            # Format results
            formatted_events = []
            for event in events:
                event_start = event.get('start', {}).get('dateTime') or event.get('start', {}).get('date')
                event_end = event.get('end', {}).get('dateTime') or event.get('end', {}).get('date')

                formatted_events.append({
                    "event_id": event.get('id'),
                    "title": event.get('summary'),
                    "start": event_start,
                    "end": event_end,
                    "description": event.get('description', ''),
                    "location": event.get('location', ''),
                    "attendees": [a.get('email') for a in event.get('attendees', [])],
                    "html_link": event.get('htmlLink')
                })

            self.log(f"Found {len(formatted_events)} upcoming events in next {days} days")

            return ActionResult(
                success=True,
                data={
                    "events": formatted_events,
                    "count": len(formatted_events),
                    "days_ahead": days
                }
            )

        except HttpError as e:
            self.log(f"Google API error: {e}", "error")
            return ActionResult(
                success=False,
                error=f"Google Calendar API error: {e}"
            )
        except Exception as e:
            self.log(f"Error listing upcoming events: {e}", "error")
            return ActionResult(success=False, error=str(e))

    async def create_recurring_event(
        self,
        title: str,
        start: str,
        end: str = None,
        recurrence_rule: str = "RRULE:FREQ=WEEKLY",
        description: str = "",
        location: str = "",
        attendees: list = None,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """
        Create a recurring calendar event

        Args:
            title: Event title
            start: Start time (ISO 8601 format)
            end: End time (ISO 8601 format). If not provided, defaults to 1 hour after start
            recurrence_rule: Recurrence rule in RRULE format (default: weekly)
            description: Event description
            location: Event location
            attendees: List of email addresses
            calendar_id: Calendar ID (default: 'primary')

        Returns:
            ActionResult with event data
        """
        try:
            # Parse start time
            start_dt = datetime.fromisoformat(start.replace('Z', '+00:00'))

            # Extract timezone - Google requires explicit timeZone field for recurring events
            timezone_name = 'UTC'
            if start_dt.tzinfo is not None:
                # Get timezone offset in hours
                offset = start_dt.utcoffset()
                if offset:
                    total_seconds = int(offset.total_seconds())
                    hours = total_seconds // 3600
                    # Convert to Etc/GMT format (note: sign is reversed!)
                    if hours == 0:
                        timezone_name = 'UTC'
                    elif hours > 0:
                        timezone_name = f'Etc/GMT-{hours}'  # Positive offset = GMT-
                    else:
                        timezone_name = f'Etc/GMT+{-hours}'  # Negative offset = GMT+

            # If no end time, default to 1 hour after start
            if not end:
                end_dt = start_dt + timedelta(hours=1)
                end = end_dt.isoformat()

            # Build event body - for recurring events, timeZone is REQUIRED
            event = {
                'summary': title,
                'description': description,
                'start': {
                    'dateTime': start,
                    'timeZone': timezone_name
                },
                'end': {
                    'dateTime': end,
                    'timeZone': timezone_name
                },
                'recurrence': [recurrence_rule]
            }

            if location:
                event['location'] = location

            if attendees:
                event['attendees'] = [{'email': email} for email in attendees]

            # Create event
            created_event = self.service.events().insert(
                calendarId=calendar_id,
                body=event
            ).execute()

            self.log(f"Created recurring calendar event: {created_event.get('id')}")

            return ActionResult(
                success=True,
                data={
                    "event_id": created_event.get('id'),
                    "title": created_event.get('summary'),
                    "start": created_event.get('start', {}).get('dateTime'),
                    "end": created_event.get('end', {}).get('dateTime'),
                    "recurrence": created_event.get('recurrence', []),
                    "html_link": created_event.get('htmlLink'),
                    "status": created_event.get('status')
                }
            )

        except HttpError as e:
            self.log(f"Google API error: {e}", "error")
            return ActionResult(
                success=False,
                error=f"Google Calendar API error: {e}"
            )
        except Exception as e:
            self.log(f"Error creating recurring event: {e}", "error")
            return ActionResult(success=False, error=str(e))

    async def add_google_meet_link(
        self,
        event_id: str,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """Add a Google Meet link to an existing event"""
        try:
            # Get existing event
            event = self.service.events().get(
                calendarId=calendar_id,
                eventId=event_id
            ).execute()

            # Add conference data for Google Meet
            event['conferenceData'] = {
                'createRequest': {
                    'requestId': f"meet-{event_id}",
                    'conferenceSolutionKey': {'type': 'hangoutsMeet'}
                }
            }

            # Update event with conference data
            updated_event = self.service.events().update(
                calendarId=calendar_id,
                eventId=event_id,
                body=event,
                conferenceDataVersion=1
            ).execute()

            meet_link = updated_event.get('conferenceData', {}).get('entryPoints', [{}])[0].get('uri', '')

            self.log(f"Added Google Meet link to event: {event_id}")

            return ActionResult(
                success=True,
                data={
                    "event_id": updated_event.get('id'),
                    "title": updated_event.get('summary'),
                    "meet_link": meet_link,
                    "html_link": updated_event.get('htmlLink')
                }
            )

        except HttpError as e:
            if e.resp.status == 404:
                self.log(f"Event not found: {event_id}", "error")
                return ActionResult(
                    success=False,
                    error=f"Event with ID '{event_id}' not found. Please search for the event first using calendar_search_events to get the correct event ID."
                )
            else:
                return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            return ActionResult(success=False, error=str(e))

    async def set_reminders(
        self,
        event_id: str,
        reminders: list = None,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """Set reminders for an event"""
        try:
            # Get existing event
            event = self.service.events().get(
                calendarId=calendar_id,
                eventId=event_id
            ).execute()

            # Set reminders
            if reminders:
                event['reminders'] = {
                    'useDefault': False,
                    'overrides': reminders
                }
            else:
                event['reminders'] = {
                    'useDefault': True
                }

            # Update event
            updated_event = self.service.events().update(
                calendarId=calendar_id,
                eventId=event_id,
                body=event
            ).execute()

            self.log(f"Set reminders for event: {event_id}")

            return ActionResult(
                success=True,
                data={
                    "event_id": updated_event.get('id'),
                    "title": updated_event.get('summary'),
                    "reminders": updated_event.get('reminders', {}),
                    "html_link": updated_event.get('htmlLink')
                }
            )

        except HttpError as e:
            if e.resp.status == 404:
                self.log(f"Event not found: {event_id}", "error")
                return ActionResult(
                    success=False,
                    error=f"Event with ID '{event_id}' not found. Please search for the event first using calendar_search_events to get the correct event ID."
                )
            else:
                return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            return ActionResult(success=False, error=str(e))

    async def add_attendees(
        self,
        event_id: str,
        attendees: list,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """Add attendees to an existing event"""
        try:
            # Get existing event
            event = self.service.events().get(
                calendarId=calendar_id,
                eventId=event_id
            ).execute()

            # Get existing attendees
            existing_attendees = event.get('attendees', [])
            existing_emails = {a.get('email') for a in existing_attendees}

            # Add new attendees (avoiding duplicates)
            for email in attendees:
                if email not in existing_emails:
                    existing_attendees.append({'email': email})

            event['attendees'] = existing_attendees

            # Update event
            updated_event = self.service.events().update(
                calendarId=calendar_id,
                eventId=event_id,
                body=event,
                sendUpdates='all'
            ).execute()

            all_attendees = [a.get('email') for a in updated_event.get('attendees', [])]

            self.log(f"Added attendees to event: {event_id}")

            return ActionResult(
                success=True,
                data={
                    "event_id": updated_event.get('id'),
                    "title": updated_event.get('summary'),
                    "attendees": all_attendees,
                    "html_link": updated_event.get('htmlLink')
                }
            )

        except HttpError as e:
            if e.resp.status == 404:
                self.log(f"Event not found: {event_id}", "error")
                return ActionResult(
                    success=False,
                    error=f"Event with ID '{event_id}' not found. Please search for the event first using calendar_search_events to get the correct event ID."
                )
            else:
                return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            return ActionResult(success=False, error=str(e))
