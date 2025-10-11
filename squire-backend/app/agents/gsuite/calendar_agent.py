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
            elif action_type == "calendar_update_event":
                return await self.update_event(**params)
            elif action_type == "calendar_delete_event":
                return await self.delete_event(**params)
            elif action_type == "calendar_get_availability":
                return await self.get_availability(**params)
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
            # Parse start time
            start_dt = datetime.fromisoformat(start.replace('Z', '+00:00'))

            # If no end time, default to 1 hour after start
            if not end:
                end_dt = start_dt + timedelta(hours=1)
                end = end_dt.isoformat()

            # Build event body
            event = {
                'summary': title,
                'description': description,
                'start': {
                    'dateTime': start,
                    'timeZone': 'UTC',
                },
                'end': {
                    'dateTime': end,
                    'timeZone': 'UTC',
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

            # Update fields
            if title:
                event['summary'] = title
            if description:
                event['description'] = description
            if location:
                event['location'] = location
            if start:
                event['start'] = {'dateTime': start, 'timeZone': 'UTC'}
            if end:
                event['end'] = {'dateTime': end, 'timeZone': 'UTC'}

            # Update event
            updated_event = self.service.events().update(
                calendarId=calendar_id,
                eventId=event_id,
                body=event
            ).execute()

            self.log(f"Updated calendar event: {event_id}")

            return ActionResult(
                success=True,
                data={
                    "event_id": updated_event.get('id'),
                    "title": updated_event.get('summary'),
                    "start": updated_event.get('start', {}).get('dateTime'),
                    "end": updated_event.get('end', {}).get('dateTime')
                }
            )

        except HttpError as e:
            return ActionResult(
                success=False,
                error=f"Google Calendar API error: {e}"
            )
        except Exception as e:
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
