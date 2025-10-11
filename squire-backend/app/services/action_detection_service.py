"""
Action Detection Service
Analyzes context to detect actionable scenarios and generate action_steps
"""
from typing import Dict, Any, List, Optional
import re
from datetime import datetime, timedelta
import dateparser


class ActionDetectionService:
    """
    Detects actionable scenarios from context and generates action_steps
    """

    def __init__(self):
        # Patterns for different action types
        self.patterns = {
            "meeting": [
                # Match: "meeting with John at 2pm", "meet with Sarah tomorrow at 3pm"
                r"meeting\s+(?:with\s+)?(.+?)\s+(?:at|@)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)",
                r"meet\s+(?:with\s+)?(.+?)\s+(?:at|@)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)",
                # Match: "call with Soniya tomorrow at 2 PM", "call Soniya at 2pm"
                r"call\s+(?:with\s+)?(.+?)\s+(?:tomorrow|today|next\s+\w+)?\s*(?:at|@)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)",
                r"call\s+(?:with\s+)?(.+?)\s+(?:at|@)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)",
                # Match: "schedule a/the call/meeting with John tomorrow at 2 PM"
                r"schedule\s+(?:a|the)?\s*(?:call|meeting)\s+(?:with\s+)?(.+?)\s+(?:tomorrow|today|next\s+\w+)?\s*(?:at|@)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)",
                # Match: "set up meeting with Sarah at 3pm tomorrow"
                r"set\s+up\s+(?:a|the)?\s*(?:call|meeting)\s+(?:with\s+)?(.+?)\s+(?:at|@)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)"
            ],
            "email_reply": [
                r"reply\s+to\s+(?:this\s+)?email",
                r"respond\s+to",
                r"get\s+back\s+to",
                r"send\s+(?:a\s+)?reply"
            ],
            "email_draft": [
                r"draft\s+(?:an?\s+)?email\s+to\s+([^\s]+@[^\s]+)",
                r"compose\s+(?:an?\s+)?email"
            ]
        }

    def analyze_context(self, context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Analyze context to detect actionable scenarios

        Args:
            context: Contains ocr_text, app_name, window_title, etc.

        Returns:
            Suggestion dict with execution_mode and action_steps, or None
        """
        app_name = context.get("app_name", "")
        ocr_text = context.get("ocr_text", [])
        meaningful_context = context.get("meaningful_context", "")

        # Combine all text
        full_text = " ".join(ocr_text) + " " + meaningful_context
        full_text_lower = full_text.lower()

        print(f"\n🔍 [ActionDetection] Analyzing context:")
        print(f"   App: {app_name}")
        print(f"   Text length: {len(full_text)} chars")
        print(f"   First 200 chars: {full_text_lower[:200]}")

        # Try to detect calendar event creation
        calendar_action = self._detect_calendar_event(full_text_lower, full_text)
        if calendar_action:
            print(f"   ✅ Detected calendar event!")
            return calendar_action

        # Try to detect email draft
        if "gmail" in app_name.lower() or "mail" in app_name.lower():
            email_action = self._detect_email_action(full_text_lower, full_text, context)
            if email_action:
                print(f"   ✅ Detected email action!")
                return email_action

        print(f"   ❌ No actionable scenario detected")
        return None

    def _detect_calendar_event(self, text_lower: str, full_text: str) -> Optional[Dict[str, Any]]:
        """Detect meeting/event mentions and generate calendar event action"""

        for i, pattern in enumerate(self.patterns["meeting"]):
            match = re.search(pattern, text_lower)
            if match:
                print(f"   ✓ Pattern {i+1} matched: '{match.group(0)}'")
                # Extract person and time
                person = match.group(1).strip() if len(match.groups()) > 0 else "Someone"
                time_str = match.group(2).strip() if len(match.groups()) > 1 else None

                print(f"   Person: {person}, Time: {time_str}")

                if not time_str:
                    print(f"   ⚠️ No time found, skipping")
                    continue

                # Parse time
                parsed_time = self._parse_time(time_str)
                if not parsed_time:
                    print(f"   ⚠️ Could not parse time, skipping")
                    continue

                # Check for date mentions (tomorrow, next week, etc.)
                event_date = self._extract_date(text_lower)
                if event_date:
                    # Combine date and time
                    start_time = datetime.combine(event_date.date(), parsed_time.time())
                    print(f"   📅 Event date: {event_date.date()}, combined: {start_time}")
                else:
                    start_time = parsed_time
                    print(f"   📅 Using parsed time: {start_time}")

                end_time = start_time + timedelta(hours=1)

                return {
                    "title": f"Schedule meeting with {person.title()}",
                    "description": f"Detected meeting mention: '{match.group(0)}'. Create a calendar event?",
                    "execution_mode": "direct",
                    "action_steps": [
                        {
                            "action_type": "calendar_create_event",
                            "action_params": {
                                "title": f"Meeting with {person.title()}",
                                "start": start_time.isoformat(),
                                "end": end_time.isoformat(),
                                "description": f"Auto-detected from: {match.group(0)}"
                            },
                            "requires_approval": True,
                            "priority": 8
                        }
                    ],
                    "confidence_score": 0.85,
                    "suggestion_type": "workflow"
                }

        print(f"   ❌ No meeting patterns matched")
        return None

    def _detect_email_action(
        self,
        text_lower: str,
        full_text: str,
        context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Detect email actions (reply, draft)"""

        # Check for draft pattern with email address
        for pattern in self.patterns["email_draft"]:
            match = re.search(pattern, text_lower)
            if match:
                # Try to extract email address
                email_match = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})", full_text)
                if email_match:
                    to_email = email_match.group(1)

                    return {
                        "title": f"Draft email to {to_email}",
                        "description": f"Would you like to draft an email to {to_email}?",
                        "execution_mode": "direct",
                        "action_steps": [
                            {
                                "action_type": "gmail_create_draft",
                                "action_params": {
                                    "to": to_email,
                                    "subject": "",
                                    "body": ""
                                },
                                "requires_approval": True,
                                "priority": 7
                            }
                        ],
                        "confidence_score": 0.75,
                        "suggestion_type": "productivity"
                    }

        # Check for reply patterns
        for pattern in self.patterns["email_reply"]:
            if re.search(pattern, text_lower):
                # Try to extract sender's email from context
                sender_email = self._extract_sender_email(context)
                if sender_email:
                    return {
                        "title": "Draft email reply",
                        "description": f"Create a draft reply to {sender_email}?",
                        "execution_mode": "direct",
                        "action_steps": [
                            {
                                "action_type": "gmail_create_draft",
                                "action_params": {
                                    "to": sender_email,
                                    "subject": f"Re: {context.get('window_title', '')}",
                                    "body": ""
                                },
                                "requires_approval": True,
                                "priority": 7
                            }
                        ],
                        "confidence_score": 0.70,
                        "suggestion_type": "productivity"
                    }

        return None

    def _parse_time(self, time_str: str) -> Optional[datetime]:
        """Parse time string to datetime"""
        try:
            # Use dateparser for flexible time parsing
            parsed = dateparser.parse(time_str)
            if parsed:
                return parsed

            # Fallback: manual parsing for common formats
            time_str = time_str.strip().lower()

            # Handle "3pm", "3:30pm", etc.
            hour_match = re.match(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", time_str)
            if hour_match:
                hour = int(hour_match.group(1))
                minute = int(hour_match.group(2)) if hour_match.group(2) else 0
                meridiem = hour_match.group(3)

                if meridiem == "pm" and hour < 12:
                    hour += 12
                elif meridiem == "am" and hour == 12:
                    hour = 0

                # Use today's date with the parsed time
                now = datetime.now()
                return now.replace(hour=hour, minute=minute, second=0, microsecond=0)

        except Exception as e:
            print(f"⚠️ Error parsing time '{time_str}': {e}")

        return None

    def _extract_date(self, text: str) -> Optional[datetime]:
        """Extract date mentions like 'tomorrow', 'next week', etc."""
        try:
            # Common date patterns
            if "tomorrow" in text:
                return datetime.now() + timedelta(days=1)
            elif "next week" in text:
                return datetime.now() + timedelta(weeks=1)
            elif "today" in text:
                return datetime.now()

            # Try to parse with dateparser
            parsed = dateparser.parse(text, settings={'PREFER_DATES_FROM': 'future'})
            if parsed:
                return parsed

        except Exception as e:
            print(f"⚠️ Error extracting date: {e}")

        return None

    def _extract_sender_email(self, context: Dict[str, Any]) -> Optional[str]:
        """Extract sender's email from context"""
        # Try to find email in window_title or meaningful_context
        text = context.get("window_title", "") + " " + context.get("meaningful_context", "")
        email_match = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})", text)
        if email_match:
            return email_match.group(1)
        return None


# Global instance
action_detection_service = ActionDetectionService()
