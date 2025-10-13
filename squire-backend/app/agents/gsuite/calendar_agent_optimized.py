"""
Optimized Google Calendar Agent with async I/O and caching
Addresses all performance issues identified
"""
import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from functools import lru_cache
import os

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from dateutil.parser import parse as parse_date

from app.agents.base_agent import BaseAgent, ActionResult, AuthenticationError

# Configure async-safe logging
logger = logging.getLogger(__name__)

# Cache service objects to avoid rebuild overhead
@lru_cache(maxsize=100)
def get_calendar_service_cached(access_token: str, refresh_token: str):
    """Cache Google Calendar service objects per token combination"""
    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.getenv("GOOGLE_CLIENT_ID"),
        client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
        scopes=[
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/calendar.events"
        ]
    )
    return build('calendar', 'v3', credentials=creds), creds


class OptimizedCalendarAgent(BaseAgent):
    """Optimized Agent for Google Calendar operations with async I/O"""

    def __init__(self, user_id: str, credentials: Dict[str, Any]):
        super().__init__(user_id, credentials)
        self.service = None
        self.creds = None

        if credentials:
            try:
                # Use cached service object
                access_token = credentials.get("access_token")
                refresh_token = credentials.get("refresh_token")

                if access_token and refresh_token:
                    self.service, self.creds = get_calendar_service_cached(
                        access_token,
                        refresh_token
                    )
                    logger.debug(f"Calendar service initialized for user {user_id}")
                else:
                    raise AuthenticationError("Missing access or refresh token")

            except Exception as e:
                logger.error(f"Failed to initialize Calendar service: {e}")
                raise AuthenticationError(f"Failed to authenticate with Google Calendar: {e}")

    async def _ensure_fresh_token(self):
        """Proactively refresh token if expired"""
        if self.creds and self.creds.expired and self.creds.refresh_token:
            logger.debug("Token expired, refreshing...")
            await asyncio.to_thread(self.creds.refresh, Request())
            logger.debug("Token refreshed successfully")

    async def _execute_api_call(self, func, *args, **kwargs):
        """Execute Google API call in thread pool to avoid blocking"""
        await self._ensure_fresh_token()
        return await asyncio.to_thread(func, *args, **kwargs)

    def _normalize_date(self, date_str: str) -> Optional[str]:
        """Simple, fast date normalization without microseconds"""
        if not date_str:
            return None

        try:
            # Use dateutil for robust parsing
            dt = parse_date(date_str)
            # Remove microseconds and return ISO format
            dt = dt.replace(microsecond=0)
            result = dt.isoformat()

            # Add 'Z' if no timezone info
            if not ('+' in result or '-' in result[-6:] or result.endswith('Z')):
                result += 'Z'

            return result
        except Exception as e:
            logger.warning(f"Failed to parse date '{date_str}': {e}")
            return None

    async def execute(self, action_type: str, params: Dict[str, Any]) -> ActionResult:
        """Execute a calendar action"""

        if not self.service:
            return ActionResult(
                success=False,
                error="Calendar service not initialized. Please connect your Google account."
            )

        try:
            # Route to appropriate method
            action_map = {
                "calendar_create_event": self.create_event,
                "calendar_search_events": self.search_events,
                "calendar_update_event": self.update_event,
                "calendar_delete_event": self.delete_event,
                "calendar_list_upcoming": self.list_upcoming_events,
                "calendar_create_recurring": self.create_recurring_event,
                "calendar_add_meet_link": self.add_google_meet_link,
                "calendar_set_reminders": self.set_reminders,
                "calendar_add_attendees": self.add_attendees,
            }

            handler = action_map.get(action_type)
            if not handler:
                return ActionResult(
                    success=False,
                    error=f"Unknown action type: {action_type}"
                )

            return await handler(**params)

        except Exception as e:
            logger.error(f"Error executing {action_type}: {e}")
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
        """Create a calendar event with optimized async I/O"""
        try:
            # Parse and normalize dates efficiently (no microseconds)
            start_dt = parse_date(start).replace(microsecond=0)

            if not end:
                # Default to 1 hour duration
                end_dt = start_dt + timedelta(hours=1)
            else:
                end_dt = parse_date(end).replace(microsecond=0)

            # Format dates properly for Google Calendar API
            start_str = start_dt.isoformat()
            end_str = end_dt.isoformat()

            # Add 'Z' if no timezone present
            if not ('+' in start_str or '-' in start_str[-6:] or start_str.endswith('Z')):
                start_str += 'Z'
            if not ('+' in end_str or '-' in end_str[-6:] or end_str.endswith('Z')):
                end_str += 'Z'

            # Build event - Google Calendar requires proper RFC3339 format
            event = {
                'summary': title,
                'description': description,
                'start': {'dateTime': start_str},
                'end': {'dateTime': end_str},
            }

            if location:
                event['location'] = location

            if attendees:
                event['attendees'] = [{'email': email} for email in attendees]

            # Execute API call in thread pool
            created_event = await self._execute_api_call(
                self.service.events().insert(
                    calendarId=calendar_id,
                    body=event
                ).execute
            )

            logger.info(f"Created calendar event: {created_event.get('id')}")

            return ActionResult(
                success=True,
                data={
                    "event_id": created_event.get('id'),
                    "title": created_event.get('summary'),
                    "start": created_event.get('start', {}).get('dateTime'),
                    "end": created_event.get('end', {}).get('dateTime'),
                    "html_link": created_event.get('htmlLink'),
                    "status": created_event.get('status')
                }
            )

        except HttpError as e:
            logger.error(f"Google API error: {e}")
            return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            logger.error(f"Error creating event: {e}")
            return ActionResult(success=False, error=str(e))

    async def search_events(
        self,
        query: str,
        start_date: str = None,
        end_date: str = None,
        max_results: int = 10,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """Search for calendar events with optimized performance"""
        try:
            # Quick date normalization
            if not start_date:
                # Format without microseconds and add 'Z' for UTC
                start_date = datetime.now().replace(microsecond=0).isoformat() + 'Z'
            else:
                parsed = parse_date(start_date)
                # Remove microseconds and ensure timezone
                start_date = parsed.replace(microsecond=0).isoformat()
                if not ('+' in start_date or '-' in start_date[-6:] or start_date.endswith('Z')):
                    start_date += 'Z'

            if not end_date:
                # Default to 7 days ahead
                end_dt = parse_date(start_date.replace('Z', '+00:00')) + timedelta(days=7)
                end_date = end_dt.replace(microsecond=0).isoformat()
                if not ('+' in end_date or '-' in end_date[-6:] or end_date.endswith('Z')):
                    end_date += 'Z'
            else:
                parsed = parse_date(end_date)
                end_date = parsed.replace(microsecond=0).isoformat()
                if not ('+' in end_date or '-' in end_date[-6:] or end_date.endswith('Z')):
                    end_date += 'Z'

            # Ensure full day range for single-day searches
            start_dt = parse_date(start_date.replace('Z', '+00:00'))
            end_dt = parse_date(end_date.replace('Z', '+00:00'))

            if start_dt.date() == end_dt.date():
                # Expand to full day (no microseconds)
                start_date = start_dt.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
                end_date = end_dt.replace(hour=23, minute=59, second=59, microsecond=0).isoformat()
                # Add Z if no timezone
                if not ('+' in start_date or '-' in start_date[-6:] or start_date.endswith('Z')):
                    start_date += 'Z'
                if not ('+' in end_date or '-' in end_date[-6:] or end_date.endswith('Z')):
                    end_date += 'Z'

            # Execute search in thread pool
            events_result = await self._execute_api_call(
                self.service.events().list(
                    calendarId=calendar_id,
                    timeMin=start_date,
                    timeMax=end_date,
                    maxResults=max_results,
                    singleEvents=True,
                    orderBy='startTime',
                    q=query if query else None
                ).execute
            )

            events = events_result.get('items', [])

            # Format results efficiently
            formatted_events = [
                {
                    "event_id": event.get('id'),
                    "title": event.get('summary', 'No Title'),
                    "start": event.get('start', {}).get('dateTime', event.get('start', {}).get('date')),
                    "end": event.get('end', {}).get('dateTime', event.get('end', {}).get('date')),
                    "description": event.get('description', ''),
                    "location": event.get('location', ''),
                    "html_link": event.get('htmlLink')
                }
                for event in events
            ]

            logger.debug(f"Found {len(formatted_events)} events matching '{query}'")

            return ActionResult(
                success=True,
                data={
                    "events": formatted_events,
                    "count": len(formatted_events),
                    "query": query
                }
            )

        except HttpError as e:
            logger.error(f"Google API error: {e}")
            return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            logger.error(f"Error searching events: {e}")
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
        """Update an existing calendar event efficiently"""
        try:
            # Get existing event
            event = await self._execute_api_call(
                self.service.events().get(
                    calendarId=calendar_id,
                    eventId=event_id
                ).execute
            )

            # Update only changed fields
            if title is not None:
                event['summary'] = title
            if description is not None:
                event['description'] = description
            if location is not None:
                event['location'] = location
            if start:
                start_dt = parse_date(start).replace(microsecond=0)
                start_str = start_dt.isoformat()
                if not ('+' in start_str or '-' in start_str[-6:] or start_str.endswith('Z')):
                    start_str += 'Z'
                event['start'] = {'dateTime': start_str}
            if end:
                end_dt = parse_date(end).replace(microsecond=0)
                end_str = end_dt.isoformat()
                if not ('+' in end_str or '-' in end_str[-6:] or end_str.endswith('Z')):
                    end_str += 'Z'
                event['end'] = {'dateTime': end_str}

            # Execute update
            updated_event = await self._execute_api_call(
                self.service.events().update(
                    calendarId=calendar_id,
                    eventId=event_id,
                    body=event
                ).execute
            )

            logger.info(f"Updated calendar event: {event_id}")

            return ActionResult(
                success=True,
                data={
                    "event_id": updated_event.get('id'),
                    "title": updated_event.get('summary'),
                    "start": updated_event.get('start', {}).get('dateTime'),
                    "end": updated_event.get('end', {}).get('dateTime'),
                    "html_link": updated_event.get('htmlLink')
                }
            )

        except HttpError as e:
            if e.resp.status == 404:
                return ActionResult(
                    success=False,
                    error=f"Event '{event_id}' not found. Please search for the event first."
                )
            logger.error(f"Google API error: {e}")
            return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            logger.error(f"Error updating event: {e}")
            return ActionResult(success=False, error=str(e))

    async def delete_event(
        self,
        event_id: str,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """Delete a calendar event"""
        try:
            await self._execute_api_call(
                self.service.events().delete(
                    calendarId=calendar_id,
                    eventId=event_id
                ).execute
            )

            logger.info(f"Deleted calendar event: {event_id}")

            return ActionResult(
                success=True,
                data={"event_id": event_id, "deleted": True}
            )

        except HttpError as e:
            if e.resp.status == 404:
                return ActionResult(
                    success=False,
                    error=f"Event '{event_id}' not found or already deleted."
                )
            logger.error(f"Google API error: {e}")
            return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            logger.error(f"Error deleting event: {e}")
            return ActionResult(success=False, error=str(e))

    async def list_upcoming_events(
        self,
        days: int = 7,
        max_results: int = 10,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """List upcoming events efficiently"""
        try:
            now = datetime.now()
            # Format without microseconds and add 'Z' for UTC
            time_min = now.replace(microsecond=0).isoformat() + 'Z'
            time_max = (now + timedelta(days=days)).replace(microsecond=0).isoformat() + 'Z'

            # Execute in thread pool
            events_result = await self._execute_api_call(
                self.service.events().list(
                    calendarId=calendar_id,
                    timeMin=time_min,
                    timeMax=time_max,
                    maxResults=max_results,
                    singleEvents=True,
                    orderBy='startTime'
                ).execute
            )

            events = events_result.get('items', [])

            formatted_events = [
                {
                    "event_id": event.get('id'),
                    "title": event.get('summary', 'No Title'),
                    "start": event.get('start', {}).get('dateTime', event.get('start', {}).get('date')),
                    "end": event.get('end', {}).get('dateTime', event.get('end', {}).get('date')),
                    "description": event.get('description', ''),
                    "location": event.get('location', ''),
                    "attendees": [a.get('email') for a in event.get('attendees', [])],
                    "html_link": event.get('htmlLink')
                }
                for event in events
            ]

            logger.debug(f"Found {len(formatted_events)} upcoming events in next {days} days")

            return ActionResult(
                success=True,
                data={
                    "events": formatted_events,
                    "count": len(formatted_events),
                    "days_ahead": days
                }
            )

        except HttpError as e:
            logger.error(f"Google API error: {e}")
            return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            logger.error(f"Error listing upcoming events: {e}")
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
        """Create a recurring calendar event"""
        try:
            start_dt = parse_date(start)

            if not end:
                end_dt = start_dt + timedelta(hours=1)
            else:
                end_dt = parse_date(end)

            # Build event with recurrence
            event = {
                'summary': title,
                'description': description,
                'start': {'dateTime': start_dt.isoformat()},
                'end': {'dateTime': end_dt.isoformat()},
                'recurrence': [recurrence_rule]
            }

            if location:
                event['location'] = location

            if attendees:
                event['attendees'] = [{'email': email} for email in attendees]

            # Execute in thread pool
            created_event = await self._execute_api_call(
                self.service.events().insert(
                    calendarId=calendar_id,
                    body=event
                ).execute
            )

            logger.info(f"Created recurring calendar event: {created_event.get('id')}")

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
            logger.error(f"Google API error: {e}")
            return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            logger.error(f"Error creating recurring event: {e}")
            return ActionResult(success=False, error=str(e))

    async def add_google_meet_link(
        self,
        event_id: str,
        calendar_id: str = "primary"
    ) -> ActionResult:
        """Add a Google Meet link to an existing event"""
        try:
            # Get existing event
            event = await self._execute_api_call(
                self.service.events().get(
                    calendarId=calendar_id,
                    eventId=event_id
                ).execute
            )

            # Add conference data
            event['conferenceData'] = {
                'createRequest': {
                    'requestId': f"meet-{event_id}",
                    'conferenceSolutionKey': {'type': 'hangoutsMeet'}
                }
            }

            # Update event with conference data
            updated_event = await self._execute_api_call(
                self.service.events().update(
                    calendarId=calendar_id,
                    eventId=event_id,
                    body=event,
                    conferenceDataVersion=1
                ).execute
            )

            meet_link = updated_event.get('conferenceData', {}).get('entryPoints', [{}])[0].get('uri', '')

            logger.info(f"Added Google Meet link to event: {event_id}")

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
                return ActionResult(
                    success=False,
                    error=f"Event '{event_id}' not found."
                )
            logger.error(f"Google API error: {e}")
            return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            logger.error(f"Error adding Google Meet link: {e}")
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
            event = await self._execute_api_call(
                self.service.events().get(
                    calendarId=calendar_id,
                    eventId=event_id
                ).execute
            )

            # Set reminders
            if reminders:
                event['reminders'] = {
                    'useDefault': False,
                    'overrides': reminders
                }
            else:
                event['reminders'] = {'useDefault': True}

            # Update event
            updated_event = await self._execute_api_call(
                self.service.events().update(
                    calendarId=calendar_id,
                    eventId=event_id,
                    body=event
                ).execute
            )

            logger.info(f"Set reminders for event: {event_id}")

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
                return ActionResult(
                    success=False,
                    error=f"Event '{event_id}' not found."
                )
            logger.error(f"Google API error: {e}")
            return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            logger.error(f"Error setting reminders: {e}")
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
            event = await self._execute_api_call(
                self.service.events().get(
                    calendarId=calendar_id,
                    eventId=event_id
                ).execute
            )

            # Get existing attendees
            existing_attendees = event.get('attendees', [])
            existing_emails = {a.get('email') for a in existing_attendees}

            # Add new attendees (avoiding duplicates)
            for email in attendees:
                if email not in existing_emails:
                    existing_attendees.append({'email': email})

            event['attendees'] = existing_attendees

            # Update event
            updated_event = await self._execute_api_call(
                self.service.events().update(
                    calendarId=calendar_id,
                    eventId=event_id,
                    body=event,
                    sendUpdates='all'
                ).execute
            )

            all_attendees = [a.get('email') for a in updated_event.get('attendees', [])]

            logger.info(f"Added attendees to event: {event_id}")

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
                return ActionResult(
                    success=False,
                    error=f"Event '{event_id}' not found."
                )
            logger.error(f"Google API error: {e}")
            return ActionResult(success=False, error=f"Google Calendar API error: {e}")
        except Exception as e:
            logger.error(f"Error adding attendees: {e}")
            return ActionResult(success=False, error=str(e))