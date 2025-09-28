"""
AI Service routes for OpenAI integration
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import openai
import os
from datetime import datetime
from uuid import UUID, uuid4

import asyncio
from app.core.database import get_supabase, execute_query, DatabaseError
from app.services.ocr_service import PaddleOCRService
from app.models.schemas import (
    AIContextRequest,
    AIContextResponse,
    UserSessionCreate,
    OCREventCreate,
    AISuggestionCreate,
    SessionType,
    UserProfileCreate,
    UserEventCreate,
    EventType,
    KnowledgeNodeCreate,
    NodeType,
    UsageMetrics
)

router = APIRouter()

# Initialize OpenAI client
openai_client = None

def get_openai_client():
    global openai_client
    if openai_client is None:
        # Try multiple ways to get the API key
        api_key = os.getenv("OPENAI_API_KEY")

        # Try importing settings to get the key
        if not api_key:
            try:
                from app.core.config import settings
                api_key = settings.OPENAI_API_KEY
            except Exception as e:
                print(f"Error getting API key from settings: {e}")

        if not api_key:
            raise HTTPException(status_code=500, detail="OpenAI API key not configured")

        openai_client = openai.OpenAI(api_key=api_key)
        print(f"OpenAI client initialized successfully")
    return openai_client

def print_text_lines(text_lines: list[str]):
    if not text_lines:
        print("No text detected.")
        return

    print("\n=== OCR Extracted Text ===")
    for idx, line in enumerate(text_lines, start=1):
        print(f"{idx:02d}. {line}")
    print("==========================\n")



class UserContext(BaseModel):
    subscription_tier: str = "free"
    timezone: str = "UTC"
    preferences: Dict[str, Any] = {}


class CurrentSession(BaseModel):
    session_start: str
    current_app: str
    window_title: str = ""
    recent_ocr_text: List[str] = []
    app_usage: Dict[str, Dict[str, Any]] = {}
    session_duration_minutes: int = 0


class ContextSignals(BaseModel):
    time_of_day: str
    day_of_week: str
    stress_indicators: Dict[str, Any] = {}


class RecentOCRContext(BaseModel):
    text_lines: List[str] = []
    workflow_indicators: Dict[str, bool] = {}


class AISuggestionRequest(BaseModel):
    user_context: UserContext
    current_session: CurrentSession
    context_signals: ContextSignals
    recent_ocr_context: RecentOCRContext


class AISuggestionResponse(BaseModel):
    type: str
    title: str
    content: Dict[str, Any]
    confidence_score: float
    priority: int
    context_data: Dict[str, Any]


class SuggestionsResponse(BaseModel):
    suggestions: List[AISuggestionResponse]


def build_openai_prompt(request: AISuggestionRequest, user_history: dict = None) -> str:
    """Build the enhanced OpenAI prompt leveraging comprehensive user history"""

    ocr_context = ""
    if request.recent_ocr_context.text_lines:
        recent_text = '\n'.join(request.recent_ocr_context.text_lines)
        ocr_context += f"Recent screen content:\n{recent_text}"

    # App usage context
    top_apps = sorted(
        request.current_session.app_usage.items(),
        key=lambda x: x[1].get('time_spent', 0),
        reverse=True
    )[:3]
    app_context = f"Currently using: {request.current_session.current_app}. "
    if top_apps:
        app_list = [f"{app} ({data.get('time_spent', 0)}s)" for app, data in top_apps]
        app_context += f"Top apps this session: {', '.join(app_list)}. "

    # App switching context
    stress_indicators = request.context_signals.stress_indicators
    stress_context = ""
    if stress_indicators.get("rapid_app_switching"):
        stress_context += "High app switching frequency detected. "

    # Build comprehensive historical context
    historical_context = ""
    if user_history:
        # Workflow patterns - what they do in each app
        if user_history.get("workflow_patterns"):
            current_app = request.current_session.current_app
            if current_app in user_history["workflow_patterns"]:
                workflow = user_history["workflow_patterns"][current_app]
                primary_activity = workflow.get("primary_activity", "general")

                historical_context += f"In {current_app}, user typically: {primary_activity}. "

        # App transition patterns
        if user_history.get("app_transitions"):
            recent_transitions = user_history["app_transitions"][-5:]  # Last 5 transitions
            if recent_transitions:
                transition_pattern = " → ".join([t["to"] for t in recent_transitions])
                historical_context += f"Recent app flow: {transition_pattern}. "

        # Successful suggestions - what works for this user
        if user_history.get("successful_suggestions"):
            successful = user_history["successful_suggestions"][:3]
            success_types = [s["type"] for s in successful]
            success_titles = [s["title"][:30] for s in successful]  # Truncate titles
            historical_context += f"User responds well to: {', '.join(success_types)} suggestions. "
            historical_context += f"Recent successful: {'; '.join(success_titles)}. "

        # Dismissed suggestions - what to avoid
        if user_history.get("dismissed_suggestions"):
            dismissed = user_history["dismissed_suggestions"][:2]
            dismissed_types = [d["type"] for d in dismissed]
            dismissed_titles = [d["title"][:30] for d in dismissed]
            if dismissed_types:
                historical_context += f"User dismissed: {', '.join(dismissed_types)} suggestions recently. "
                historical_context += f"Avoid similar to: {'; '.join(dismissed_titles)}. "

        # Activity areas for targeted suggestions
        if user_history.get("skill_areas"):
            activities = [skill["name"].replace("_programming", "").replace("_language", "")
                         for skill in user_history["skill_areas"][:4]]
            historical_context += f"User activities: {', '.join(activities)}. "

        # Usage patterns
        if user_history.get("usage_patterns"):
            patterns = user_history["usage_patterns"]
            avg_session = patterns.get("avg_session_length", 30)
            total_suggestions = patterns.get("total_suggestions", 0)
            if avg_session > 60:
                historical_context += "User tends to have longer work sessions. "
            if total_suggestions > 20:
                historical_context += "User actively engages with suggestions. "


        # Time patterns
        if user_history.get("time_patterns"):
            time_data = user_history["time_patterns"]
            session_trends = time_data.get("session_trends", [])
            if session_trends:
                recent_sessions = len([t for t in session_trends if t.get("date", "")])
                if recent_sessions > 5:
                    historical_context += "User has been consistently active recently. "

    # Instructions for avoiding duplicates and allowing no suggestions
    duplicate_avoidance = ""
    if user_history and user_history.get("suggestion_history"):
        recent_titles = [s["title"] for s in user_history["suggestion_history"][:10]]
        if recent_titles:
            duplicate_avoidance = f"\nRECENT SUGGESTIONS (DO NOT REPEAT): {'; '.join(recent_titles[:5])}"
            duplicate_avoidance += f"\nIMPORTANT: If you cannot provide something genuinely new and valuable that differs from recent suggestions, return an empty suggestions array instead of repeating or slightly modifying previous suggestions."

    prompt = f"""You are an AI efficiency assistant. Analyze the user's current context and provide ONE highly relevant, personalized suggestion to improve their workflow efficiency.

IMPORTANT: "Squire" is the name of THIS suggestion app. Do NOT suggest features for Squire itself. Focus on external tools, workflows, and productivity tips for the user's actual work.

CURRENT CONTEXT:
App: {request.current_session.current_app}
Time: {request.context_signals.time_of_day} on {request.context_signals.day_of_week}

SCREEN CONTENT:
{ocr_context}

SESSION INFO:
{app_context}
{stress_context}

USER HISTORY & PATTERNS:
{historical_context}

{duplicate_avoidance}

REQUIREMENTS:
- Provide exactly ONE suggestion that is highly specific to their current context
- Make it actionable and immediately useful for their ACTUAL WORK (not for using this app)
- Focus on external tools, keyboard shortcuts, workflows, or productivity techniques
- DO NOT suggest Squire features, settings, or improvements to this app
- Include high-level action_steps (3-5 steps) that outline the main implementation phases
- Set requires_detailed_guide to true for suggestions needing specific setup steps
- List all tools_needed (apps, extensions, services) required for implementation
- Specify applicable platforms (macOS, Windows, web, etc.)
- Consider their historical patterns and preferences
- Avoid anything similar to recent suggestions
- Be creative and offer genuine value
- If nothing novel can be suggested, return empty suggestions array

Return JSON (either one suggestion OR empty array):
{{
  "suggestions": [
    {{
      "type": "workflow|automation|optimization|learning|reminder|insight|efficiency",
      "title": "Specific, actionable suggestion title",
      "content": {{
        "description": "Clear description of what to do and why",
        "action_steps": ["High-level step 1", "High-level step 2", "High-level step 3"],
        "expected_benefit": "What this will achieve for the user",
        "difficulty": "easy|medium|hard",
        "time_investment": "X minutes",
        "requires_detailed_guide": true,
        "tools_needed": ["App/tool name 1", "App/tool name 2"],
        "platforms": ["macOS", "Windows", "web"]
      }},
      "confidence_score": 0.X,
      "priority": X,
      "context_data": {{
        "triggers": ["What triggered this suggestion"],
        "relevant_apps": ["{request.current_session.current_app}"],
        "time_sensitive": true/false
      }}
    }}
  ]
}}

If no novel suggestion possible, return: {{"suggestions": []}}"""

    return prompt


async def get_user_history(user_id: UUID, supabase=None):
    """Get user's comprehensive historical data for enhanced context"""
    try:
        history = {
            "recent_sessions": [],
            "top_apps": [],
            "recent_suggestions": [],
            "usage_patterns": {},
            "skill_areas": [],
            "suggestion_history": [],
            "workflow_patterns": [],
            "time_patterns": {},
            "successful_suggestions": [],
            "dismissed_suggestions": [],
            "app_transitions": []
        }

        # Get recent sessions (last 7 days)
        recent_sessions = await execute_query(
            table="user_sessions",
            operation="select",
            filters={"user_id": str(user_id)},
            order_by="created_at",
            ascending=False,
            limit=10
        )

        if recent_sessions:
            history["recent_sessions"] = [
                {
                    "session_type": session.get("session_type", "general"),
                    "duration_minutes": session.get("session_duration_minutes", 0),
                    "date": session.get("created_at", "")[:10]  # Just date part
                } for session in recent_sessions[:5]
            ]

        # Get top apps from recent usage metrics (if table exists)
        try:
            recent_metrics = await execute_query(
                table="usage_metrics",
                operation="select",
                filters={"user_id": str(user_id)},
                order_by="date",
                ascending=False,
                limit=7
            )
        except Exception as e:
            print(f"Usage metrics table not found: {e}")
            recent_metrics = []

        if recent_metrics:
            app_totals = {}
            for metric in recent_metrics:
                app_usage = metric.get("app_usage", {})
                for app, minutes in app_usage.items():
                    app_totals[app] = app_totals.get(app, 0) + minutes

            history["top_apps"] = sorted(app_totals.items(), key=lambda x: x[1], reverse=True)[:5]

        # Get recent successful suggestions (clicked ones)
        # Note: Need to join with sessions to filter by user_id
        recent_suggestions = await execute_query(
            table="ai_suggestions",
            operation="select",
            filters={"status": "clicked"},
            order_by="created_at",
            ascending=False,
            limit=20
        )

        # Filter by user_id manually since we need to join with sessions
        user_suggestions = []
        if recent_suggestions:
            for suggestion in recent_suggestions:
                # Get session to check user_id
                session = await execute_query(
                    table="user_sessions",
                    operation="select",
                    filters={"id": suggestion.get("session_id")},
                    single=True
                )
                if session and session.get("user_id") == str(user_id):
                    user_suggestions.append(suggestion)
                    if len(user_suggestions) >= 10:
                        break

        recent_suggestions = user_suggestions

        if recent_suggestions:
            history["recent_suggestions"] = [
                {
                    "type": sug.get("suggestion_type", ""),
                    "title": sug.get("title", ""),
                    "confidence": sug.get("confidence_score", 0)
                } for sug in recent_suggestions[:5]
            ]

        # Get usage patterns from metrics (if table exists)
        if recent_metrics:
            avg_session_length = sum(m.get("session_duration", 30) for m in recent_metrics) / len(recent_metrics)
            total_suggestions = sum(m.get("suggestions_generated", 0) for m in recent_metrics)

            history["usage_patterns"] = {
                "avg_session_length": round(avg_session_length, 1),
                "total_suggestions": total_suggestions,
                "active_days": len(recent_metrics)
            }
        else:
            # Default usage patterns when no metrics available
            history["usage_patterns"] = {
                "avg_session_length": 30.0,
                "total_suggestions": 0,
                "active_days": 0
            }

        # Get skill areas from knowledge nodes
        skill_nodes = await execute_query(
            table="knowledge_nodes",
            operation="select",
            filters={"user_id": str(user_id), "node_type": "skill"},
            order_by="weight",
            ascending=False,
            limit=5
        )

        if skill_nodes:
            history["skill_areas"] = [
                {
                    "name": node.get("content", {}).get("name", "").replace("_programming", ""),
                    "weight": node.get("weight", 0)
                } for node in skill_nodes
            ]

        # Get comprehensive suggestion history (last 30 days)
        all_suggestions = await execute_query(
            table="ai_suggestions",
            operation="select",
            filters={"user_id": str(user_id)},
            order_by="created_at",
            ascending=False,
            limit=100
        )

        if all_suggestions:
            # Categorize suggestions by status
            for suggestion in all_suggestions:
                status = suggestion.get("status", "pending")
                created_at = suggestion.get("created_at", "")

                # Extract content from database format
                suggestion_content = suggestion.get("suggestion_content", {})
                title = suggestion_content.get("title", suggestion.get("title", ""))

                # Add to general suggestion history
                history["suggestion_history"].append({
                    "id": suggestion.get("id"),
                    "type": suggestion.get("suggestion_type", ""),
                    "title": title,
                    "content": suggestion_content,
                    "status": status,
                    "created_at": created_at,
                    "confidence": suggestion.get("confidence_score", 0)
                })

                # Categorize by interaction type
                if status in ["accepted", "clicked"]:
                    history["successful_suggestions"].append({
                        "type": suggestion.get("suggestion_type", ""),
                        "title": title,
                        "content": suggestion_content,
                        "created_at": created_at
                    })
                elif status == "dismissed":
                    history["dismissed_suggestions"].append({
                        "type": suggestion.get("suggestion_type", ""),
                        "title": title,
                        "reason": suggestion.get("feedback", {}).get("reason", ""),
                        "created_at": created_at
                    })

        # Get detailed app transition patterns from user events
        app_events = await execute_query(
            table="user_events",
            operation="select",
            filters={"event_type": "app_switch"},
            order_by="created_at",
            ascending=False,
            limit=50
        )

        if app_events:
            transitions = []
            prev_app = None
            for event in reversed(app_events):  # Process chronologically
                session_id = event.get("session_id")
                # Get session to verify user_id
                session = await execute_query(
                    table="user_sessions",
                    operation="select",
                    filters={"id": session_id},
                    single=True
                )
                if session and session.get("user_id") == str(user_id):
                    current_app = event.get("event_data", {}).get("app_name", "")
                    if prev_app and current_app != prev_app:
                        transitions.append({
                            "from": prev_app,
                            "to": current_app,
                            "timestamp": event.get("created_at", "")
                        })
                    prev_app = current_app

            history["app_transitions"] = transitions[-20:]  # Last 20 transitions

        # Get workflow patterns from OCR events
        # First get OCR events from recent sessions
        recent_ocr = []
        for session in recent_sessions[:5]:
            session_id = session.get("id")
            if session_id:
                ocr_events = await execute_query(
                    table="ocr_events",
                    operation="select",
                    filters={"session_id": session_id},
                    order_by="created_at",
                    ascending=False,
                    limit=10
                )
                if ocr_events:
                    recent_ocr.extend(ocr_events)

        if recent_ocr:
            workflows = {}
            error_keywords = []

            for ocr_event in recent_ocr:
                app_name = ocr_event.get("app_name", "")
                context_data = ocr_event.get("context_data", {})
                ocr_context = context_data.get("recent_ocr_context", {})

                # Build workflow patterns
                if app_name not in workflows:
                    workflows[app_name] = {
                        "activities": []
                    }

                # Detect activity patterns
                workflow_indicators = ocr_context.get("workflow_indicators", {})
                for indicator, detected in workflow_indicators.items():
                    if detected:
                        workflows[app_name]["activities"].append(indicator)

            # Determine primary activity for each app
            for app in workflows:
                workflows[app]["primary_activity"] = max(set(workflows[app]["activities"]),
                                                        key=workflows[app]["activities"].count) if workflows[app]["activities"] else "general"

            history["workflow_patterns"] = workflows

        # Analyze time-based patterns
        if recent_metrics:
            time_patterns = {
                "usage_by_time": {},
                "session_trends": []
            }

            # Track basic usage patterns
            for metric in recent_metrics:
                date = metric.get("date", "")
                session_duration = metric.get("session_duration", 0)
                time_patterns["session_trends"].append({
                    "date": date,
                    "duration": session_duration
                })

            history["time_patterns"] = time_patterns

        return history

    except Exception as e:
        print(f"Error getting user history: {e}")
        return {
            "recent_sessions": [],
            "top_apps": [],
            "recent_suggestions": [],
            "usage_patterns": {},
            "skill_areas": []
        }


async def calculate_suggestion_similarity(suggestion1: dict, suggestion2: dict) -> float:
    """Calculate similarity score between two suggestions (0.0 to 1.0)"""
    try:
        # Compare titles (most important)
        title1 = suggestion1.get("title", "").lower().strip()
        title2 = suggestion2.get("title", "").lower().strip()

        if not title1 or not title2:
            return 0.0

        # Exact title match
        if title1 == title2:
            return 1.0

        # Calculate word overlap
        words1 = set(title1.split())
        words2 = set(title2.split())

        if not words1 or not words2:
            return 0.0

        word_overlap = len(words1.intersection(words2)) / len(words1.union(words2))

        # Compare types
        type1 = suggestion1.get("type", "")
        type2 = suggestion2.get("type", "")
        type_match = 1.0 if type1 == type2 else 0.0

        # Compare content descriptions
        content1 = suggestion1.get("content", {})
        content2 = suggestion2.get("content", {})

        desc1 = content1.get("description", "").lower().strip()
        desc2 = content2.get("description", "").lower().strip()

        desc_similarity = 0.0
        if desc1 and desc2:
            desc_words1 = set(desc1.split())
            desc_words2 = set(desc2.split())
            if desc_words1 and desc_words2:
                desc_similarity = len(desc_words1.intersection(desc_words2)) / len(desc_words1.union(desc_words2))

        # Weighted similarity score
        similarity = (
            word_overlap * 0.5 +          # Title word overlap (50%)
            type_match * 0.3 +            # Type match (30%)
            desc_similarity * 0.2         # Description similarity (20%)
        )

        return min(similarity, 1.0)

    except Exception as e:
        print(f"Error calculating suggestion similarity: {e}")
        return 0.0


async def filter_duplicate_suggestions(new_suggestions: List[dict], user_history: dict, similarity_threshold: float = 0.75) -> List[dict]:
    """Filter out duplicate or very similar suggestions from recent history"""
    try:
        if not user_history.get("suggestion_history"):
            return new_suggestions

        # Get recent suggestions (last 24 hours)
        from datetime import datetime, timedelta
        cutoff_time = datetime.now() - timedelta(hours=24)

        recent_suggestions = []
        for hist_suggestion in user_history["suggestion_history"]:
            try:
                created_at_str = hist_suggestion.get("created_at", "")
                if created_at_str:
                    # Parse the timestamp (handle various formats)
                    if "T" in created_at_str:
                        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                    else:
                        created_at = datetime.fromisoformat(created_at_str)

                    if created_at > cutoff_time:
                        recent_suggestions.append(hist_suggestion)
            except Exception:
                # If we can't parse the date, include it to be safe
                recent_suggestions.append(hist_suggestion)

        # Filter new suggestions against recent ones
        filtered_suggestions = []

        for new_suggestion in new_suggestions:
            is_duplicate = False

            for recent_suggestion in recent_suggestions:
                similarity = await calculate_suggestion_similarity(new_suggestion, recent_suggestion)

                if similarity >= similarity_threshold:
                    print(f"Filtered duplicate suggestion: '{new_suggestion.get('title', '')}' (similarity: {similarity:.2f})")
                    is_duplicate = True
                    break

            if not is_duplicate:
                filtered_suggestions.append(new_suggestion)

        print(f"Suggestion filtering: {len(new_suggestions)} → {len(filtered_suggestions)} (removed {len(new_suggestions) - len(filtered_suggestions)} duplicates)")
        return filtered_suggestions

    except Exception as e:
        print(f"Error filtering duplicate suggestions: {e}")
        return new_suggestions


async def ensure_user_profile(user_id: UUID, supabase=None):
    """Ensure user profile exists, create if it doesn't"""
    try:
        # Check if profile exists
        existing_profiles = await execute_query(
            table="user_profiles",
            operation="select",
            filters={"id": str(user_id)},
            limit=1
        )

        if existing_profiles and len(existing_profiles) > 0:
            return existing_profiles[0]["id"]

        # Create new profile
        profile_data = {
            "id": str(user_id),
            "email": f"user_{str(user_id)[:8]}@example.com",
            "full_name": f"User {str(user_id)[:8]}",
            "timezone": "UTC",
            "preferences": {"notification_frequency": "medium"},
            "settings": {"theme": "dark", "auto_suggestions": True},
            "metadata": {"created_via": "squire_app"}
        }

        result = await execute_query(
            table="user_profiles",
            operation="insert",
            data=profile_data
        )

        return result[0]["id"] if result else str(user_id)

    except Exception as e:
        print(f"Error ensuring user profile: {e}")
        return str(user_id)


async def save_context_data(request: AIContextRequest, suggestions: List[AISuggestionResponse], ai_request: AISuggestionRequest, supabase=None):
    """Save OCR context and AI suggestions to all relevant database tables"""
    try:
        # Ensure user profile exists
        await ensure_user_profile(request.user_id, supabase)

        # Create or get session
        session_data = {
            "user_id": str(request.user_id),
            "device_info": request.current_session,
            "session_type": SessionType.GENERAL.value
        }

        session_result = await execute_query(
            table="user_sessions",
            operation="insert",
            data=session_data
        )
        session_id = session_result[0]["id"] if session_result else str(uuid4())

        print("Inserted session:", session_result)


        # Save app switch event
        app_switch_event = {
            "user_id": str(request.user_id),
            "session_id": session_id,
            "event_type": EventType.APP_SWITCH.value,
            "event_data": {
                "app_name": request.app_name,
                "window_title": request.window_title
            },
            "importance_score": 0.7
        }

        await execute_query(
            table="user_events",
            operation="insert",
            data=app_switch_event
        )

        # Save OCR capture event and data
        ocr_event_data = {
            "user_id": str(request.user_id),
            "session_id": session_id,
            "event_type": EventType.OCR_CAPTURE.value,
            "event_data": {
                "ocr_lines_count": len(request.ocr_text)
            },
            "importance_score": 0.6
        }

        await execute_query(
            table="user_events",
            operation="insert",
            data=ocr_event_data
        )

        # Save OCR event details
        ocr_data = {
            "session_id": session_id,
            "app_name": request.app_name,
            "window_title": request.window_title,
            "ocr_text": request.ocr_text,
            "context_data": {
                "context_signals": request.context_signals,
                "recent_ocr_context": request.recent_ocr_context
            }
        }

        ocr_result = await execute_query(
            table="ocr_events",
            operation="insert",
            data=ocr_data
        )
        ocr_event_id = ocr_result[0]["id"] if ocr_result else str(uuid4())

        print("Inserted OCR event:", ocr_result)


        # Save AI suggestions
        for suggestion in suggestions:
            # Format suggestion content for database
            suggestion_content = {
                "title": suggestion.title,
                "description": suggestion.content.get("description", ""),
                "action_steps": suggestion.content.get("action_steps", []),
                "expected_benefit": suggestion.content.get("expected_benefit", ""),
                "difficulty": suggestion.content.get("difficulty", ""),
                "time_investment": suggestion.content.get("time_investment", "")
            }

            suggestion_data = {
                "user_id": str(request.user_id),
                "session_id": session_id,
                "ocr_event_id": ocr_event_id,
                "suggestion_type": suggestion.type,
                "suggestion_content": suggestion_content,
                "confidence_score": suggestion.confidence_score,
                "priority": suggestion.priority,
                "context_data": suggestion.context_data,
                "status": "pending"
            }

            print("Saving AI suggestion to DB:", suggestion_data)


            await execute_query(
                table="ai_suggestions",
                operation="insert",
                data=suggestion_data
            )

        # Create/update knowledge nodes based on detected patterns
        await update_knowledge_graph(request, ai_request, suggestions, supabase)

        # Save usage metrics
        await save_usage_metrics(request, ai_request, suggestions, session_id, supabase)

        return session_id, ocr_event_id

    except Exception as e:
        print(f"Error saving context data: {e}")
        return None, None


async def update_knowledge_graph(context_request: AIContextRequest, ai_request: AISuggestionRequest, suggestions: List[AISuggestionResponse], supabase=None):
    """Update knowledge graph based on detected patterns and app usage"""
    try:
        user_id = str(context_request.user_id)

        # Create tool/app knowledge node
        
        app_node_data = {
            "user_id": user_id,
            "node_type": NodeType.TOOL.value,
            "content": {
                "name": ai_request.current_session.current_app,
                "description": f"Application: {ai_request.current_session.current_app}",
                "category": "software",
                "last_used": datetime.now().isoformat()
            },
            "weight": 1.0
        }

        print("App node data prepared:", app_node_data)


        # Check if node exists (using content to match since name column doesn't exist)
        existing_node = await execute_query(
            table="knowledge_nodes",
            operation="select",
            filters={"user_id": user_id, "node_type": NodeType.TOOL.value},
            single=True
        )

        if not existing_node:
            print("Creating new node")
            await execute_query(
                table="knowledge_nodes",
                operation="insert",
                data=app_node_data
            )
        else:
            # Update weight and content
            updated_content = existing_node.get("content", {})
            updated_content.update(app_node_data["content"])

            print("Updating existing app node:", existing_node)
            await execute_query(
                table="knowledge_nodes",
                operation="update",
                data={
                    "content": updated_content,
                    "weight": min(existing_node.get("weight", 1.0) + 0.1, 5.0)  # Cap at 5.0
                },
                filters={"id": existing_node["id"]}
            )


        # Create dynamic content pattern nodes based on actual content characteristics
        workflow_indicators = ai_request.recent_ocr_context.workflow_indicators
        for indicator, detected in workflow_indicators.items():
            if detected:
                pattern_node_data = {
                    "user_id": user_id,
                    "node_type": NodeType.PATTERN.value,
                    "content": {
                        "name": f"content_{indicator}",
                        "description": f"User works with content that {indicator.replace('_', ' ')}",
                        "category": "content_pattern",
                        "pattern_type": indicator,
                        "frequency": "regular",
                        "last_detected": datetime.now().isoformat(),
                        "app_context": ai_request.current_session.current_app
                    },
                    "weight": 0.3
                }

                existing_pattern = await execute_query(
                    table="knowledge_nodes",
                    operation="select",
                    filters={"user_id": user_id, "node_type": NodeType.PATTERN.value},
                    single=True
                )

                print("Pattern node data prepared:", pattern_node_data)


                if not existing_pattern:
                    await execute_query(
                        table="knowledge_nodes",
                        operation="insert",
                        data=pattern_node_data
                    )
                else:
                    # Increase weight for repeated patterns
                    await execute_query(
                        table="knowledge_nodes",
                        operation="update",
                        data={"weight": min(existing_pattern.get("weight", 0.3) + 0.1, 2.0)},
                        filters={"id": existing_pattern["id"]}
                    )

    except Exception as e:
        print(f"Error updating knowledge graph: {e}")


async def save_usage_metrics(context_request: AIContextRequest, ai_request: AISuggestionRequest, suggestions: List[AISuggestionResponse], session_id: str, supabase=None):
    """Save usage metrics for analytics (if table exists)"""
    try:
        # Calculate app usage from current session
        current_session = ai_request.current_session
        app_usage = current_session.app_usage

        # Convert to minutes and ensure it's a proper format
        app_usage_minutes = {}
        for app, data in app_usage.items():
            if isinstance(data, dict) and "time_spent" in data:
                app_usage_minutes[app] = max(1, data["time_spent"] // 60)  # Convert to minutes, minimum 1
            else:
                app_usage_minutes[app] = 1

        # Calculate efficiency indicators
        stress_indicators = ai_request.context_signals.stress_indicators
        has_rapid_switching = stress_indicators.get("rapid_app_switching", False)
        efficiency_indicator = "low" if has_rapid_switching else "normal"

        metrics_data = {
            "user_id": str(context_request.user_id),
            "date": datetime.now().date().isoformat(),
            "app_usage": app_usage_minutes,
            "suggestions_generated": len(suggestions),
            "suggestions_clicked": 0,  # Would be updated when user clicks
            "session_duration": current_session.session_duration_minutes,
            "efficiency_indicator": efficiency_indicator
        }

        # Try to save metrics (skip if table doesn't exist)
        try:
            # Check if metrics for today already exist
            existing_metrics = await execute_query(
                table="usage_metrics",
                operation="select",
                filters={
                    "user_id": str(context_request.user_id),
                    "date": datetime.now().date().isoformat()
                },
                single=False  # allow multiple or empty
            )

            if existing_metrics and len(existing_metrics) > 0:
                existing_metrics = existing_metrics[0]
            else:
                existing_metrics = None


            if existing_metrics:
                # Update existing metrics
                updated_app_usage = existing_metrics.get("app_usage", {})
                for app, minutes in app_usage_minutes.items():
                    updated_app_usage[app] = updated_app_usage.get(app, 0) + minutes

                await execute_query(
                    table="usage_metrics",
                    operation="update",
                    data={
                        "app_usage": updated_app_usage,
                        "suggestions_generated": existing_metrics.get("suggestions_generated", 0) + len(suggestions),
                        "session_duration": existing_metrics.get("session_duration", 0) + metrics_data["session_duration"],
                        "efficiency_indicator": efficiency_indicator
                    },
                    filters={"id": existing_metrics["id"]}
                )
            else:
                # Create new metrics
                await execute_query(
                    table="usage_metrics",
                    operation="insert",
                    data=metrics_data
                )
        except Exception as metrics_error:
            print(f"Could not save usage metrics (table may not exist): {metrics_error}")
            # Continue without metrics - this is not critical

    except Exception as e:
        print(f"Error saving usage metrics: {e}")


@router.post("/context", response_model=AIContextResponse)
async def save_ai_context(
    request: AIContextRequest,
    supabase=Depends(get_supabase)
):
    """Save OCR context and generate AI suggestions with data persistence"""
    print(f"🔄 AI Context Request received for user: {request.user_id}")
    print(f"   📱 App: {request.app_name}")
    print(f"   📝 OCR: {request.ocr_text}")

    try:
        # Convert the request to the old format for AI processing
        ai_request = AISuggestionRequest(
            user_context=UserContext(**request.user_context),
            current_session=CurrentSession(**request.current_session),
            context_signals=ContextSignals(**request.context_signals),
            recent_ocr_context=RecentOCRContext(**request.recent_ocr_context)
        )

        # Get user history for enhanced context
        user_history = await get_user_history(request.user_id, supabase)

        # Generate AI suggestions with historical context
        client = get_openai_client()
        prompt = build_openai_prompt(ai_request, user_history)

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful efficiency assistant. Always respond with valid JSON only. Be concise and actionable."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=800,
            temperature=0.7,
            response_format={"type": "json_object"}
        )

        content = response.choices[0].message.content.strip()

        print("Raw model output:", content)


        # Parse the JSON response
        import json
        try:
            suggestions_data = json.loads(content)
            raw_suggestions = [
                AISuggestionResponse(**suggestion)
                for suggestion in suggestions_data.get('suggestions', [])
            ]

            # Filter out duplicate suggestions using our enhanced system
            suggestion_dicts = [sug.dict() for sug in raw_suggestions]
            filtered_suggestions_dicts = await filter_duplicate_suggestions(
                suggestion_dicts,
                user_history,
                similarity_threshold=0.75
            )

            # Convert back to response objects
            suggestions = [
                AISuggestionResponse(**sug_dict)
                for sug_dict in filtered_suggestions_dicts
            ]

            print("Parsed suggestions JSON:", suggestions_data)


            # If all suggestions were filtered out, generate a fallback
            if not suggestions:
                print("⚠️ All suggestions were filtered as duplicates, providing fallback")
                suggestions = [AISuggestionResponse(
                    type="reminder",
                    title="Focus Break",
                    content={
                        "description": f"Take a moment to optimize your {request.app_name} workflow",
                        "action_steps": ["Take 30 seconds to think", "Identify one small improvement"],
                        "expected_benefit": "Enhanced focus and efficiency",
                        "difficulty": "easy",
                        "time_investment": "30 seconds"
                    },
                    confidence_score=0.4,
                    priority=4,
                    context_data={
                        "triggers": ["Fallback after duplicate filtering"],
                        "relevant_apps": [request.app_name],
                        "time_sensitive": False
                    }
                )]

        except json.JSONDecodeError as e:
            print(f"JSON parsing error: {e}")
            # Fallback suggestion
            suggestions = [AISuggestionResponse(
                type="reminder",
                title="Stay Focused",
                content={
                    "description": f"Continue working on {request.app_name}",
                    "action_steps": ["Take a deep breath", "Focus on current task"],
                    "expected_benefit": "Maintain workflow efficiency",
                    "difficulty": "easy",
                    "time_investment": "1 minute"
                },
                confidence_score=0.5,
                priority=5,
                context_data={
                    "triggers": [f"When using {request.app_name}"],
                    "relevant_apps": [request.app_name],
                    "time_sensitive": False
                }
            )]

        # Save data to database
        session_id, ocr_event_id = await save_context_data(request, suggestions, ai_request, supabase)

        print(f"✅ Generated {len(suggestions)} suggestions and saved to database")

        return AIContextResponse(
            session_id=UUID(session_id) if session_id else uuid4(),
            ocr_event_id=UUID(ocr_event_id) if ocr_event_id else uuid4(),
            suggestions=[suggestion.dict() for suggestion in suggestions]
        )

    except Exception as e:
        print(f"❌ AI context error: {str(e)}")

        # Return minimal response even on error
        return AIContextResponse(
            session_id=uuid4(),
            ocr_event_id=uuid4(),
            suggestions=[{
                "type": "reminder",
                "title": "Keep Going",
                "content": {
                    "description": "Continue your current work session",
                    "action_steps": ["Focus on your current task"],
                    "expected_benefit": "Maintain workflow",
                    "difficulty": "easy",
                    "time_investment": "0 minutes"
                },
                "confidence_score": 0.3,
                "priority": 3,
                "context_data": {
                    "triggers": ["General"],
                    "relevant_apps": [],
                    "time_sensitive": False
                }
            }],
            message="Error occurred but continuing"
        )


@router.post("/detailed-guide")
async def generate_detailed_guide(request: dict):
    """Generate detailed step-by-step implementation guide for a suggestion"""
    try:
        suggestion_data = request.get("suggestion")
        user_platform = request.get("platform", "macOS")

        if not suggestion_data:
            raise HTTPException(status_code=400, detail="Suggestion data required")

        # Create detailed guide using OpenAI
        guide = await create_detailed_implementation_guide(suggestion_data, user_platform)

        return {
            "status": "success",
            "detailed_guide": guide
        }

    except Exception as e:
        print(f"Error generating detailed guide: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def create_detailed_implementation_guide(suggestion: dict, platform: str = "macOS"):
    """Generate comprehensive step-by-step guide with web research"""
    try:
        # Extract suggestion details
        title = suggestion.get("title", "")
        description = suggestion.get("content", {}).get("description", "")
        tools_needed = suggestion.get("content", {}).get("tools_needed", [])
        high_level_steps = suggestion.get("content", {}).get("action_steps", [])

        # Build detailed prompt for implementation guide
        guide_prompt = f"""You are an expert implementation guide creator. Generate a comprehensive, step-by-step guide for implementing this productivity suggestion.

SUGGESTION TO IMPLEMENT:
Title: {title}
Description: {description}
Platform: {platform}
Tools Needed: {', '.join(tools_needed)}
High-Level Steps: {'; '.join(high_level_steps)}

REQUIREMENTS:
Create a detailed implementation guide with:

1. PREPARATION PHASE:
   - Exact downloads/installations needed (with URLs when possible)
   - System requirements and compatibility checks
   - Account setup requirements

2. STEP-BY-STEP IMPLEMENTATION:
   - Numbered steps with specific actions
   - Exact menu paths (e.g., "System Settings → Privacy & Security → Accessibility")
   - Keyboard shortcuts to press (e.g., "Press Cmd+Shift+A")
   - Specific text to type or settings to change
   - Screenshots descriptions where helpful

3. VERIFICATION & TESTING:
   - How to test that each step worked
   - Expected results at each stage
   - Troubleshooting common issues

4. OPTIMIZATION TIPS:
   - Advanced settings or customizations
   - Power user shortcuts
   - Integration with other tools

Make it so detailed that a user could follow it without opening any browser tabs or searching for additional information.

Return JSON:
{{
  "guide": {{
    "preparation": {{
      "downloads": [
        {{
          "name": "App/Tool Name",
          "url": "https://example.com/download",
          "version": "v1.2.3",
          "size": "50MB",
          "requirements": "macOS 12+"
        }}
      ],
      "prerequisites": ["Requirement 1", "Requirement 2"]
    }},
    "steps": [
      {{
        "step_number": 1,
        "title": "Step Title",
        "description": "What this step accomplishes",
        "actions": [
          {{
            "type": "click|keyboard|download|install|type",
            "instruction": "Specific instruction",
            "details": "Additional context or exact paths",
            "shortcut": "Cmd+X (if applicable)"
          }}
        ],
        "verification": "How to verify this step worked",
        "troubleshooting": "Common issues and solutions"
      }}
    ],
    "testing": {{
      "how_to_test": "Steps to verify everything works",
      "expected_result": "What success looks like",
      "common_issues": ["Issue 1", "Issue 2"]
    }},
    "optimization": {{
      "advanced_settings": ["Setting 1", "Setting 2"],
      "power_tips": ["Tip 1", "Tip 2"],
      "integrations": ["Tool A integration", "Tool B workflow"]
    }},
    "estimated_time": "15 minutes",
    "difficulty_level": "easy|medium|hard"
  }}
}}"""

        # Make OpenAI API call for detailed guide
        print(f"🔧 Generating detailed implementation guide for: {title}")

        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert technical writer who creates incredibly detailed, step-by-step implementation guides. Always respond with valid JSON only. Be extremely specific about every click, keystroke, and action required."
                },
                {
                    "role": "user",
                    "content": guide_prompt
                }
            ],
            max_tokens=1500,
            temperature=0.3,  # Lower temperature for more precise instructions
            response_format={"type": "json_object"}
        )

        content = response.choices[0].message.content.strip()
        print(f"📋 Generated detailed guide: {len(content)} characters")

        # Parse JSON response
        import json
        try:
            guide_data = json.loads(content)
            return guide_data.get("guide", {})
        except json.JSONDecodeError as e:
            print(f"JSON parsing error for guide: {e}")
            # Fallback response
            return {
                "preparation": {"downloads": [], "prerequisites": []},
                "steps": [{
                    "step_number": 1,
                    "title": "Implementation Guide Unavailable",
                    "description": "Unable to generate detailed guide at this time",
                    "actions": [{"type": "manual", "instruction": "Please search online for implementation details", "details": description}],
                    "verification": "N/A",
                    "troubleshooting": "Contact support if needed"
                }],
                "testing": {"how_to_test": "Manual verification required", "expected_result": "Feature should work as described"},
                "optimization": {"advanced_settings": [], "power_tips": [], "integrations": []},
                "estimated_time": "Varies",
                "difficulty_level": "medium"
            }

    except Exception as e:
        print(f"Error creating detailed guide: {e}")
        raise


@router.post("/suggestion/{suggestion_id}/click")
async def track_suggestion_click(
    suggestion_id: UUID,
    supabase=Depends(get_supabase)
):
    """Track when a user clicks on an AI suggestion"""
    try:
        # Update suggestion status
        await execute_query(
            table="ai_suggestions",
            operation="update",
            data={"status": "clicked"},
            filters={"id": str(suggestion_id)}
        )

        # Get suggestion details for event tracking
        suggestion = await execute_query(
            table="ai_suggestions",
            operation="select",
            filters={"id": str(suggestion_id)},
            single=True
        )

        if suggestion:
            # Create click event
            click_event = {
                "user_id": suggestion["user_id"],
                "session_id": suggestion["session_id"],
                "event_type": EventType.SUGGESTION_CLICK.value,
                "event_data": {
                    "suggestion_id": str(suggestion_id),
                    "suggestion_type": suggestion["suggestion_type"],
                    "suggestion_title": suggestion["title"]
                },
                "importance_score": 0.8
            }

            await execute_query(
                table="user_events",
                operation="insert",
                data=click_event
            )

            print(f"✅ Tracked suggestion click: {suggestion['title']}")

        return {"status": "success", "message": "Click tracked successfully"}

    except Exception as e:
        print(f"❌ Error tracking suggestion click: {e}")
        raise HTTPException(status_code=500, detail="Failed to track suggestion click")


@router.post("/suggestions", response_model=SuggestionsResponse)
async def generate_ai_suggestions(request: AISuggestionRequest):
    """Generate AI suggestions based on user context"""
    print(f"🔄 AI Suggestion Request received")
    print(f"   📱 App: {request.current_session.current_app}")
    print(f"   📝 OCR Lines: {len(request.recent_ocr_context.text_lines)}")
    print(f"   🧠 App Switching: {request.context_signals.stress_indicators.get('rapid_app_switching', False)}")

    try:
        client = get_openai_client()
        print(f"✅ OpenAI client ready")

        # Build the prompt
        prompt = build_openai_prompt(request)

        # Make OpenAI API call
        print(f"🤖 Making OpenAI API call...")
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful efficiency assistant. Always respond with valid JSON only. Be concise and actionable."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=800,
            temperature=0.7
        )

        content = response.choices[0].message.content.strip()

        # Parse the JSON response
        import json
        try:
            suggestions_data = json.loads(content)
            suggestions = [
                AISuggestionResponse(**suggestion)
                for suggestion in suggestions_data.get('suggestions', [])
            ]
            print(f"✅ Generated {len(suggestions)} suggestions successfully")
            return SuggestionsResponse(suggestions=suggestions)
        except json.JSONDecodeError as e:
            # If JSON parsing fails, return a fallback suggestion
            fallback_suggestion = AISuggestionResponse(
                type="reminder",
                title="Stay Focused",
                content={
                    "description": f"Continue working on {request.current_session.current_app}",
                    "action_steps": ["Take a deep breath", "Focus on current task"],
                    "expected_benefit": "Maintain workflow efficiency",
                    "difficulty": "easy",
                    "time_investment": "1 minute"
                },
                confidence_score=0.5,
                priority=5,
                context_data={
                    "triggers": [f"When using {request.current_session.current_app}"],
                    "relevant_apps": [request.current_session.current_app],
                    "time_sensitive": False
                }
            )
            return SuggestionsResponse(suggestions=[fallback_suggestion])

    except Exception as e:
        # Log the error (in production, use proper logging)
        print(f"❌ AI suggestion error: {str(e)}")
        print(f"   Error type: {type(e).__name__}")

        # Return fallback suggestion
        fallback = AISuggestionResponse(
            type="reminder",
            title="Keep Going",
            content={
                "description": "Continue your current work session",
                "action_steps": ["Focus on your current task"],
                "expected_benefit": "Maintain workflow",
                "difficulty": "easy",
                "time_investment": "0 minutes"
            },
            confidence_score=0.3,
            priority=3,
            context_data={
                "triggers": ["General"],
                "relevant_apps": [],
                "time_sensitive": False
            }
        )
        return SuggestionsResponse(suggestions=[fallback])


@router.get("/user/{user_id}/history")
async def get_user_history_debug(
    user_id: UUID,
    supabase=Depends(get_supabase)
):
    """Debug endpoint to view user's historical data"""
    try:
        history = await get_user_history(user_id, supabase)
        return {
            "user_id": str(user_id),
            "history_summary": {
                "recent_sessions": len(history.get("recent_sessions", [])),
                "suggestion_history": len(history.get("suggestion_history", [])),
                "successful_suggestions": len(history.get("successful_suggestions", [])),
                "dismissed_suggestions": len(history.get("dismissed_suggestions", [])),
                "workflow_patterns": list(history.get("workflow_patterns", {}).keys()),
                "app_transitions": len(history.get("app_transitions", [])),
                "skill_areas": len(history.get("skill_areas", []))
            },
            "full_history": history
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving user history: {str(e)}")


@router.post("/test-similarity")
async def test_suggestion_similarity():
    """Test endpoint for suggestion similarity calculation"""
    try:
        # Test cases
        suggestion1 = {
            "title": "Take a 5-minute break",
            "type": "reminder",
            "content": {"description": "Step away from the computer for a few minutes"}
        }

        suggestion2 = {
            "title": "Take a short break",
            "type": "reminder",
            "content": {"description": "Take a quick break from work"}
        }

        suggestion3 = {
            "title": "Organize your workspace",
            "type": "efficiency",
            "content": {"description": "Declutter and arrange your work environment"}
        }

        similarity_1_2 = await calculate_suggestion_similarity(suggestion1, suggestion2)
        similarity_1_3 = await calculate_suggestion_similarity(suggestion1, suggestion3)
        similarity_2_3 = await calculate_suggestion_similarity(suggestion2, suggestion3)

        return {
            "test_cases": {
                "similar_suggestions": {
                    "suggestion1": suggestion1,
                    "suggestion2": suggestion2,
                    "similarity": similarity_1_2
                },
                "different_suggestions_1": {
                    "suggestion1": suggestion1,
                    "suggestion3": suggestion3,
                    "similarity": similarity_1_3
                },
                "different_suggestions_2": {
                    "suggestion2": suggestion2,
                    "suggestion3": suggestion3,
                    "similarity": similarity_2_3
                }
            },
            "thresholds": {
                "high_similarity": ">= 0.75 (filtered as duplicate)",
                "medium_similarity": "0.5 - 0.74 (related but allowed)",
                "low_similarity": "< 0.5 (different suggestions)"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error testing similarity: {str(e)}")


@router.post("/ocr")
async def process_ocr(file: UploadFile = File(...)):
    """Process image with PaddleOCR"""
    try:
        image_data = await file.read()
        ocr_service = PaddleOCRService()
        
        text_lines = await asyncio.to_thread(ocr_service.process_image, image_data)
        print_text_lines(text_lines)

        # return {"text_lines": text_lines}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def ai_health_check():
    """Check AI service health"""
    try:
        client = get_openai_client()
        return {
            "status": "healthy",
            "openai_configured": True,
            "enhanced_features": {
                "historical_context": True,
                "duplicate_filtering": True,
                "workflow_patterns": True,
                "similarity_scoring": True
            },
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "openai_configured": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }
