"""
AI Service routes for OpenAI integration
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import openai
import os
import json
from datetime import datetime
from uuid import UUID, uuid4

from app.core.database import get_supabase, execute_query, DatabaseError
from app.services.ocr_service import PaddleOCRService
from app.services.keystroke_analysis_service import KeystrokeAnalysisService
from app.services.ocr_job_manager import OCRJobManager, JobPriority
from app.services.vision_job_manager import vision_job_manager
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
ocr_service = PaddleOCRService()
keystroke_analysis_service = KeystrokeAnalysisService()
ocr_job_manager = OCRJobManager(max_workers=4)


# Define context analysis result classes
class ContextAnalysisResult(BaseModel):
    concepts: List[str] = []
    tools: List[str] = []
    current_activity: str = "unknown"
    context_type: str = "work"
    domain: str = "general"
    confidence_score: float = 0.0


class MultiLevelContext(BaseModel):
    micro: str = "unknown"
    task: str = "unknown"
    app: str = "unknown"
    session: str = "unknown"


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
                pass  # Silent fail, will raise below

        if not api_key:
            raise HTTPException(status_code=500, detail="OpenAI API key not configured")

        openai_client = openai.OpenAI(api_key=api_key)
    return openai_client


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




async def extract_meaningful_context(ocr_lines: List[str], app_name: str, window_title: str = "") -> str:
    """Extract a meaningful summary from OCR content with specific details"""
    client = get_openai_client()
    if not ocr_lines or not client or len(ocr_lines) == 0:
        return ""

    content = '\n'.join(ocr_lines[:50])

    prompt = f"""Analyze this screen content and provide a DETAILED summary with SPECIFIC information.

APP: {app_name}
WINDOW: {window_title}

CONTENT:
{content}

INSTRUCTIONS:
- Extract and mention SPECIFIC details: file names, function names, error messages, URLs, variable names, numbers, dates
- Note any ERROR messages or WARNING text verbatim
- Identify specific UI elements: button labels, menu items, field names
- Mention specific text that appears (don't just say "code" - mention function/class names)
- Include specific numbers, metrics, or values visible
- Note any identifiable patterns or repeated elements

Provide a detailed 3-4 sentence summary with concrete specifics."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=250
        )

        result = response.choices[0].message.content.strip()
        return result
    except Exception as e:
        return ""


async def extract_session_context(ocr_lines: List[str], app_name: str, window_title: str = "") -> Dict[str, str]:
    """Extract context_type, domain, and activity_summary from OCR content for app_sessions"""
    client = get_openai_client()
    if not ocr_lines or not client or len(ocr_lines) == 0:
        return {"context_type": "general", "domain": "general", "activity_summary": ""}


    content = '\n'.join(ocr_lines[:50])  # First 50 lines to keep prompt size reasonable

    prompt = f"""Analyze this screen content and extract structured context information.

APP: {app_name}
WINDOW: {window_title}

SCREEN CONTENT:
{content}

Extract the following in JSON format:
{{
  "context_type": "work|learning|debugging|creating|configuring|communication|browsing|other",
  "domain": "software_development|data_analysis|design|writing|research|communication|entertainment|other",
  "activity_summary": "Brief 1-sentence description of what user is doing"
}}

Examples:
- Coding in VS Code → {{"context_type": "creating", "domain": "software_development", "activity_summary": "Writing React component for authentication"}}
- Viewing Stack Overflow → {{"context_type": "learning", "domain": "software_development", "activity_summary": "Researching Python error handling patterns"}}
- Email client → {{"context_type": "communication", "domain": "communication", "activity_summary": "Reading and responding to work emails"}}
- Terminal with error → {{"context_type": "debugging", "domain": "software_development", "activity_summary": "Troubleshooting module import error"}}

Return only the JSON object, no other text."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=200,
            response_format={"type": "json_object"}
        )

        result_text = response.choices[0].message.content.strip()

        # Parse JSON response
        # Remove markdown code blocks if present
        if result_text.startswith("```"):
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
        result_text = result_text.strip()

        try:
            context_data = json.loads(result_text)
            result = {
                "context_type": context_data.get("context_type", "general"),
                "domain": context_data.get("domain", "general"),
                "activity_summary": context_data.get("activity_summary", "")
            }
            return result
        except json.JSONDecodeError as json_err:
            return {"context_type": "general", "domain": "general", "activity_summary": ""}

    except Exception as e:
        return {"context_type": "general", "domain": "general", "activity_summary": ""}

def detect_error_state(ocr_lines: List[str]) -> Dict[str, Any]:
    """Detect if the current screen shows error states or problematic content"""
    text = ' '.join(ocr_lines).lower()

    error_keywords = {
        'syntax_error': ['syntax error', 'syntaxerror', 'invalid syntax', 'unexpected token'],
        'runtime_error': ['runtime error', 'runtimeerror', 'exception', 'traceback', 'stack trace'],
        'network_error': ['connection failed', 'network error', 'timeout', 'unable to connect', '404', '500', '503'],
        'authentication_error': ['unauthorized', 'access denied', 'permission denied', 'login failed', '401', '403'],
        'validation_error': ['validation error', 'invalid input', 'required field', 'missing parameter'],
        'build_error': ['build failed', 'compilation error', 'cannot find module', 'module not found'],
        'database_error': ['database error', 'connection refused', 'table does not exist', 'query failed'],
        'file_error': ['file not found', 'no such file', 'permission denied', 'cannot read file'],
        'general_error': ['error', 'failed', 'critical', 'fatal', 'exception', 'warning', 'alert']
    }

    detected_errors = []
    error_urgency = 0

    for error_type, keywords in error_keywords.items():
        for keyword in keywords:
            if keyword in text:
                detected_errors.append(error_type)
                # Higher urgency for critical errors
                if error_type in ['syntax_error', 'runtime_error', 'build_error']:
                    error_urgency = max(error_urgency, 3)
                elif error_type in ['network_error', 'database_error']:
                    error_urgency = max(error_urgency, 2)
                else:
                    error_urgency = max(error_urgency, 1)
                break

    # Remove duplicates
    detected_errors = list(set(detected_errors))

    return {
        "has_errors": len(detected_errors) > 0,
        "error_types": detected_errors,
        "error_urgency": error_urgency,  # 0=none, 1=low, 2=medium, 3=high
        "suggests_debugging": error_urgency >= 2
    }


async def analyze_current_context(ocr_lines: List[str],
                                app_context: str = "",
                                recent_activities: List[str] = []) -> ContextAnalysisResult:
    """Use LLM to understand what the user is currently doing"""

    client = get_openai_client()
    if not ocr_lines or not client:
        return ContextAnalysisResult()

    content = '\n'.join(ocr_lines)

    # Detect error states first
    error_indicators = detect_error_state(ocr_lines)

    history_context = ""
    if recent_activities:
        history_context = f"\nRecent activities: {', '.join(recent_activities[-3:])}"

    error_context = ""
    if error_indicators["has_errors"]:
        error_context = f"\nERROR DETECTED: {', '.join(error_indicators['error_types'])} (urgency: {error_indicators['error_urgency']}/3)"

    prompt = f"""Analyze what the user is currently doing based on their screen content.

CURRENT SCREEN:
App: {app_context or 'Unknown'}
Content:
{content}
{history_context}
{error_context}

Return JSON with immediate context:
{{
  "current_activity": "brief description of immediate activity",
  "context_type": "work|learning|debugging|creating|researching|communicating|planning|analyzing|error_handling",
  "domain": "general field or subject area",
  "concepts": ["relevant concept1", "concept2"],
  "tools": ["tool1", "tool2"],
  "confidence_score": 0.8
}}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a context analyst. Understand what the user is currently doing and provide relevant context. Always respond with valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=400,
            temperature=0.2,
            response_format={"type": "json_object"}
        )

        analysis = json.loads(response.choices[0].message.content)

        return ContextAnalysisResult(
            concepts=analysis.get('concepts', []),
            tools=analysis.get('tools', []),
            current_activity=analysis.get('current_activity', 'general_work'),
            context_type=analysis.get('context_type', 'work'),
            domain=analysis.get('domain', 'general'),
            confidence_score=analysis.get('confidence_score', 0.5)
        )

    except Exception as e:
        return ContextAnalysisResult([], [], "unknown", "work", "general", 0.0)


async def analyze_multi_level_context(current_ocr: List[str],
                                    app_context: str,
                                    user_history: Dict = None) -> MultiLevelContext:
    """Analyze context at multiple time scales using LLM"""

    client = get_openai_client()
    if not client:
        return MultiLevelContext("unknown", "unknown", "unknown", "unknown")

    current_content = '\n'.join(current_ocr)

    # Build context from user history
    recent_context = ""
    session_context = ""

    if user_history:
        if user_history.get('recent_suggestions'):
            recent_suggestions = [s.get('type', '') for s in user_history['recent_suggestions'][:3]]
            recent_context = f"Recent suggestion types: {', '.join(recent_suggestions)}"

        if user_history.get('workflow_patterns'):
            patterns = list(user_history['workflow_patterns'].keys())[:3]
            session_context = f"User workflow patterns: {', '.join(patterns)}"

    prompt = f"""Analyze user context at multiple time scales.

CURRENT MOMENT:
App: {app_context}
Screen: {current_content}

RECENT CONTEXT:
{recent_context}

SESSION CONTEXT:
{session_context}

Provide context understanding at 4 levels:
1. MICRO (immediate 5-30 seconds): What are they doing right now?
2. TASK (current minutes): What task/goal are they working on?
3. APP (app session): What are they accomplishing in this app?
4. SESSION (hours): What's the overarching theme of this work session?

Return JSON:
{{
  "micro_context": "immediate action (e.g., 'reading error message', 'typing code')",
  "task_context": "current task (e.g., 'debugging authentication issue')",
  "app_context": "app-level work (e.g., 'developing new feature')",
  "session_context": "session theme (e.g., 'product development work')"
}}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a context analyst specializing in understanding user activity patterns across different time scales. Always respond with valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=500,
            temperature=0.2,
            response_format={"type": "json_object"}
        )

        analysis = json.loads(response.choices[0].message.content)

        return MultiLevelContext(
            micro=analysis.get('micro_context', 'working'),
            task=analysis.get('task_context', 'general task'),
            app=analysis.get('app_context', 'using application'),
            session=analysis.get('session_context', 'work session')
        )

    except Exception as e:
        pass
        return MultiLevelContext("unknown", "unknown", "unknown", "unknown")


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


class AppSequenceItem(BaseModel):
    timestamp: int
    appName: str
    windowTitle: str = ""
    bundleId: str = ""
    ocrText: List[str] = []
    meaningful_context: str = ""  # Summarized context instead of raw OCR
    sequence: int
    trigger_reason: str = "unknown"
    duration_in_app: int = 0
    application_type: str = ""  # Type of app: development, creative, productivity, etc.
    interaction_context: str = ""  # What user is doing: menu_navigation, content_creation, etc.
    extracted_entities: List[Dict] = []  # Entities extracted from OCR: tasks, files, etc.

class SequenceMetadata(BaseModel):
    sequence_id: str
    total_apps: int
    sequence_duration: int
    rapid_switching: bool
    unique_apps: int
    trigger_reasons: List[str]
    workflow_pattern: str

class BatchContextRequest(BaseModel):
    user_id: str
    session_id: str
    sequence_metadata: SequenceMetadata
    app_sequence: List[AppSequenceItem]
    request_type: str = "batch_analysis"
    context_signals: Dict[str, Any] = {}


async def build_enhanced_openai_prompt(request: AISuggestionRequest, user_history: dict = None) -> str:
    """Build the enhanced OpenAI prompt with LLM-driven context analysis"""

    ocr_context = ""
    if request.recent_ocr_context.text_lines:
        recent_text = '\n'.join(request.recent_ocr_context.text_lines)
        ocr_context += f"Recent screen content:\n{recent_text}"

        # Get enhanced context analysis
        try:
            current_context = await analyze_current_context(
                request.recent_ocr_context.text_lines,
                request.current_session.current_app,
                user_history.get('recent_activities', []) if user_history else None
            )

            multi_level_context = await analyze_multi_level_context(
                request.recent_ocr_context.text_lines,
                request.current_session.current_app,
                user_history
            )

            # Enhanced context information
            ocr_context += f"\n\nCONTEXT ANALYSIS:"
            ocr_context += f"\n• Current activity: {current_context.current_activity}"
            ocr_context += f"\n• Activity type: {current_context.context_type}"
            ocr_context += f"\n• Domain: {current_context.domain}"
            if current_context.concepts:
                ocr_context += f"\n• Key concepts: {', '.join(current_context.concepts)}"
            if current_context.tools:
                ocr_context += f"\n• Tools in use: {', '.join(current_context.tools)}"

            ocr_context += f"\n\nMULTI-LEVEL CONTEXT:"
            ocr_context += f"\n• Right now: {multi_level_context.micro}"
            ocr_context += f"\n• Current task: {multi_level_context.task}"
            ocr_context += f"\n• App session: {multi_level_context.app}"
            ocr_context += f"\n• Overall session: {multi_level_context.session}"


        except Exception as e:
            # Fall back to basic context
            pass

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

        # Activity areas for targeted suggestions with proficiency
        if user_history.get("skill_areas"):
            skills_with_prof = [f"{skill.get('name', '').replace('_programming', '').replace('_language', '')} ({skill.get('proficiency', 'intermediate')})"
                               for skill in user_history["skill_areas"][:5]]
            historical_context += f"Skills: {', '.join(skills_with_prof)}. "

        # Tools and proficiency
        if user_history.get("tools"):
            tools_with_prof = [f"{tool.get('name', '')} ({tool.get('proficiency', 'intermediate')})"
                              for tool in user_history["tools"][:5]]
            historical_context += f"Tools: {', '.join(tools_with_prof)}. "

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

        # Keystroke efficiency patterns
        if user_history.get("keystroke_patterns"):
            keystroke_data = user_history["keystroke_patterns"]
            if keystroke_data:
                # Analyze efficiency patterns from keystroke data
                apps_with_patterns = [pattern.get("app_context") for pattern in keystroke_data if pattern.get("app_context")]
                if apps_with_patterns:
                    historical_context += f"Recent keystroke patterns in: {', '.join(set(apps_with_patterns))}. "

                # Check for efficiency indicators
                for pattern in keystroke_data[:2]:  # Look at recent patterns
                    efficiency_indicators = pattern.get("efficiency_indicators", {})
                    if efficiency_indicators.get("repetitive_sequences"):
                        historical_context += f"Detected repetitive keystroke patterns in {pattern.get('app_context', 'recent apps')}. "
                    if efficiency_indicators.get("navigation_sequences"):
                        historical_context += f"Frequent navigation key usage in {pattern.get('app_context', 'recent apps')}. "

        # Keystroke efficiency summary
        keystroke_efficiency = user_history.get("keystroke_efficiency", {})
        if keystroke_efficiency and keystroke_efficiency.get("total_analyses", 0) > 0:
            avg_eff = keystroke_efficiency.get("avg_efficiency", 0.5)
            eff_rating = "high" if avg_eff > 0.7 else "moderate" if avg_eff > 0.4 else "low"
            historical_context += f"Overall typing efficiency: {eff_rating} ({avg_eff:.2f}). "

            recommendations = keystroke_efficiency.get("top_recommendations", [])
            if recommendations:
                rec_types = [r.get("type", "").replace("_", " ") for r in recommendations[:2]]
                if rec_types:
                    historical_context += f"Efficiency opportunities: {', '.join(rec_types)}. "

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
        "short_description": "One concise sentence (max 80 chars) summarizing the suggestion",
        "description": "Clear detailed description of what to do and why",
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

    print("📝 PROMPT SENT TO LLM:")
    print("-" * 80)
    print(prompt)
    print("-" * 80)
    print("🔚 END PROMPT")
    print("="*80 + "\n")

    return prompt


async def get_vision_context(user_id: str, app_name: Optional[str] = None, limit: int = 3) -> str:
    """
    Fetch recent UNUSED vision insights for a user.

    Returns formatted vision context string for LLM prompt.
    Marks retrieved events as used so they won't be reused.
    """
    try:
        print(f"\n{'='*60}")
        print(f"🔮 [AI] GET VISION CONTEXT")
        print(f"   User ID: {user_id}")
        print(f"   App filter: {app_name or 'all apps'}")
        print(f"   Limit: {limit}")

        # Get recent UNUSED vision events (only from last 60 minutes)
        vision_events = await vision_job_manager.get_recent_vision_events(
            user_id=user_id,
            limit=limit,
            app_name=app_name,
            max_age_minutes=60,
            only_unused=True  # Only get unused events
        )

        if not vision_events:
            print("⚠️ No unused vision events found (check VisionJobManager logs above)")
            print(f"{'='*60}\n")
            return ""

        print(f"   Retrieved {len(vision_events)} UNUSED vision events")

        vision_context = "\n🔮 VISION INSIGHTS (Visual Context from Screenshots):\n"
        events_added = 0
        event_ids_to_mark = []

        for i, event in enumerate(vision_events, 1):
            analysis = event.get("vision_analysis", {})

            if not analysis or "error" in analysis:
                print(f"   ⚠️ Event {i} skipped (no analysis or error)")
                continue

            event_id = event.get("id")
            event_app = event.get("app_name", "Unknown App")
            event_time = event.get("created_at", "unknown time")
            print(f"   ✅ Event {i}: {event_app} at {event_time} [id={event_id}]")

            vision_context += f"\n{i}. {event_app} (at {event_time}):\n"

            # Add task/activity with more detail
            task = analysis.get("task", "")
            if task:
                vision_context += f"   • Task/Activity: {task}\n"

            # Add ALL UI elements (don't limit - we need specifics)
            ui_elements = analysis.get("ui_elements", [])
            if ui_elements:
                elements_str = ", ".join(ui_elements)
                vision_context += f"   • Visible UI Elements: {elements_str}\n"

            # Add visible text
            visible_text = analysis.get("visible_text", [])
            if visible_text:
                text_str = ", ".join(visible_text[:10])  # First 10 text items
                vision_context += f"   • Visible Text/Labels: {text_str}\n"

            # Add context with emphasis on specifics
            context = analysis.get("context", "")
            if context:
                vision_context += f"   • Visual Context: {context}\n"

            # Add patterns
            patterns = analysis.get("patterns", "")
            if patterns:
                vision_context += f"   • Detected Patterns: {patterns}\n"

            # Add insights
            insights = analysis.get("insights", "")
            if insights:
                vision_context += f"   • AI Insights: {insights}\n"

            # Add any error indicators from vision
            errors = analysis.get("errors_detected", [])
            if errors:
                vision_context += f"   • ⚠️ Errors/Warnings Visible: {', '.join(errors)}\n"

            # Add specific screen state details
            screen_state = analysis.get("screen_state", "")
            if screen_state:
                vision_context += f"   • Screen State: {screen_state}\n"

            events_added += 1
            if event_id:
                event_ids_to_mark.append(event_id)

        # Mark all retrieved events as used in LLM
        if event_ids_to_mark:
            await vision_job_manager.mark_events_as_used(event_ids_to_mark)

        print(f"\n   📊 Vision context summary:")
        print(f"      - Total events retrieved: {len(vision_events)}")
        print(f"      - Events added to context: {events_added}")
        print(f"      - Events marked as used: {len(event_ids_to_mark)}")
        print(f"      - Context length: {len(vision_context)} chars")
        print(f"{'='*60}\n")

        return vision_context

    except Exception as e:
        print(f"❌ Error fetching vision context: {e}")
        import traceback
        traceback.print_exc()
        return ""


async def build_batch_openai_prompt(request: BatchContextRequest, user_history: dict = None) -> str:
    """Build sequence-aware OpenAI prompt with full context integration (including vision)"""


    # Build detailed sequence context with OCR content
    sequence_context = ""
    sequence_context += f"WORKFLOW SEQUENCE ANALYSIS:\n"
    sequence_context += f"Sequence ID: {request.sequence_metadata.sequence_id}\n"
    sequence_context += f"Pattern: {request.sequence_metadata.workflow_pattern}\n"
    sequence_context += f"Duration: {request.sequence_metadata.sequence_duration}ms\n"
    sequence_context += f"Apps: {request.sequence_metadata.total_apps} unique: {request.sequence_metadata.unique_apps}\n"
    sequence_context += f"Rapid switching: {request.sequence_metadata.rapid_switching}\n\n"

    # Build detailed app sequence with meaningful context summaries
    sequence_context += "DETAILED APP TRANSITION SEQUENCE:\n"
    for i, app in enumerate(request.app_sequence):
        sequence_context += f"\n{i+1}. {app.appName}"
        if app.windowTitle:
            sequence_context += f" - {app.windowTitle}"
        sequence_context += f" (trigger: {app.trigger_reason})\n"

        # Use pre-extracted meaningful context only (never raw OCR)
        if app.meaningful_context:
            sequence_context += f"   Context:\n{app.meaningful_context}\n"
        else:
            sequence_context += f"   Context: • No context available\n"

        # Add OCR enhanced fields
        if hasattr(app, 'application_type') and app.application_type:
            sequence_context += f"   App Type: {app.application_type}\n"
        if hasattr(app, 'interaction_context') and app.interaction_context and app.interaction_context != 'unknown':
            sequence_context += f"   Interaction: {app.interaction_context}\n"
        if hasattr(app, 'extracted_entities') and app.extracted_entities:
            entities_str = ', '.join([str(e.get('content', str(e)))[:50] for e in app.extracted_entities[:5]])  # First 5, truncate to 50 chars
            sequence_context += f"   Entities: [{entities_str}]\n"

        if app.duration_in_app > 0:
            sequence_context += f"   Duration: {app.duration_in_app}ms\n"

    # Get enhanced context analysis for the most recent app
    if request.app_sequence:
        latest_app = request.app_sequence[-1]

        # Only analyze if we have meaningful context
        if latest_app.meaningful_context:
            try:
                # Use meaningful context (not raw OCR)
                context_for_analysis = [latest_app.meaningful_context]

                current_context = await analyze_current_context(
                    context_for_analysis,
                    latest_app.appName,
                    None
                )
                multi_level_context = await analyze_multi_level_context(
                    context_for_analysis,
                    latest_app.appName,
                    user_history
                )

                sequence_context += f"\nENHANCED CONTEXT ANALYSIS (Current State):\n"
                sequence_context += f"• Current activity: {current_context.current_activity}\n"
                sequence_context += f"• Activity type: {current_context.context_type}\n"
                sequence_context += f"• Domain: {current_context.domain}\n"
                if current_context.concepts:
                    sequence_context += f"• Key concepts: {', '.join(current_context.concepts)}\n"
                if current_context.tools:
                    sequence_context += f"• Tools in use: {', '.join(current_context.tools)}\n"

                sequence_context += f"\nMULTI-LEVEL CONTEXT:\n"
                sequence_context += f"• Right now: {multi_level_context.micro}\n"
                sequence_context += f"• Current task: {multi_level_context.task}\n"
                sequence_context += f"• App session: {multi_level_context.app}\n"
                sequence_context += f"• Overall session: {multi_level_context.session}\n"

            except Exception as e:
                sequence_context += f"\nContext analysis not available\n"
        else:
            sequence_context += f"\nContext analysis not available\n"

    # Fetch and add vision context for the current app
    vision_context = ""
    if request.app_sequence and request.user_id:
        latest_app = request.app_sequence[-1]
        vision_context = await get_vision_context(
            user_id=request.user_id,
            app_name=latest_app.appName,
            limit=3
        )

    # Add comprehensive user history context
    history_context = ""
    if user_history:
        # Historical context for personalization
        historical_context = ""

        # Top apps and usage patterns
        top_apps = user_history.get("top_apps", [])
        if top_apps:
            historical_context += f"Primary apps: {', '.join([app.get('app_name', '') for app in top_apps[:5]])}. "

        # Skill areas and expertise with proficiency levels
        skill_areas = user_history.get("skill_areas", [])
        if skill_areas:
            skills_with_prof = [f"{skill.get('name', '')} ({skill.get('proficiency', 'intermediate')})" for skill in skill_areas[:5]]
            historical_context += f"Skills: {', '.join(skills_with_prof)}. "

        # Tools and proficiency
        tools = user_history.get("tools", [])
        if tools:
            tools_with_prof = [f"{tool.get('name', '')} ({tool.get('proficiency', 'intermediate')})" for tool in tools[:5]]
            historical_context += f"Tools: {', '.join(tools_with_prof)}. "

            # Tool relationships for workflow understanding
            tool_rels = user_history.get("tool_relationships", [])
            if tool_rels:
                strong_rels = [rel for rel in tool_rels if rel.get("strength", 0) > 0.6]
                if strong_rels:
                    rel_types = list(set([rel.get("type", "") for rel in strong_rels[:3]]))
                    historical_context += f"Tool workflow patterns detected: {', '.join(rel_types)}. "

        # Workflow patterns
        workflow_patterns = user_history.get('workflow_patterns', {})
        if workflow_patterns:
            patterns_text = ', '.join(list(workflow_patterns.keys())[:3])
            historical_context += f"Common workflow patterns: {patterns_text}. "

        # App transitions for context switching understanding
        app_transitions = user_history.get("app_transitions", [])
        if app_transitions:
            frequent_transitions = [t for t in app_transitions if t.get("frequency", 0) > 2][:3]
            if frequent_transitions:
                transition_pairs = [f"{t.get('from_app', '')}->{t.get('to_app', '')}" for t in frequent_transitions]
                historical_context += f"Frequent app transitions: {', '.join(transition_pairs)}. "

        # Time patterns and session info
        time_patterns = user_history.get("time_patterns", {})
        if time_patterns:
            peak_hours = time_patterns.get("peak_productivity_hours", [])
            if peak_hours:
                historical_context += f"Most productive hours: {'-'.join(map(str, peak_hours[:2]))}. "

            session_trends = time_patterns.get("session_trends", [])
            if session_trends:
                recent_sessions = len([t for t in session_trends if t.get("date", "")])
                if recent_sessions > 5:
                    historical_context += "User has been consistently active recently. "

        # Keystroke efficiency patterns
        keystroke_patterns = user_history.get("keystroke_patterns", [])
        if keystroke_patterns:
            apps_with_patterns = [pattern.get("app_context") for pattern in keystroke_patterns if pattern.get("app_context")]
            if apps_with_patterns:
                historical_context += f"Recent keystroke patterns in: {', '.join(set(apps_with_patterns))}. "

            # Check for efficiency indicators
            for pattern in keystroke_patterns[:2]:
                efficiency_indicators = pattern.get("efficiency_indicators", {})
                if efficiency_indicators.get("repetitive_sequences"):
                    historical_context += f"Detected repetitive keystroke patterns in {pattern.get('app_context', 'recent apps')}. "

        # Keystroke efficiency summary
        keystroke_efficiency = user_history.get("keystroke_efficiency", {})
        if keystroke_efficiency and keystroke_efficiency.get("total_analyses", 0) > 0:
            avg_eff = keystroke_efficiency.get("avg_efficiency", 0.5)
            eff_rating = "high" if avg_eff > 0.7 else "moderate" if avg_eff > 0.4 else "low"
            historical_context += f"Overall typing efficiency: {eff_rating} ({avg_eff:.2f}). "

            recommendations = keystroke_efficiency.get("top_recommendations", [])
            if recommendations:
                rec_types = [r.get("type", "").replace("_", " ") for r in recommendations[:2]]
                if rec_types:
                    historical_context += f"Efficiency opportunities: {', '.join(rec_types)}. "

        if historical_context:
            history_context += f"\nUSER HISTORY & PATTERNS:\n{historical_context}\n"

        # Recent suggestions to avoid duplicates
        recent_suggestions = user_history.get("suggestion_history", [])
        if recent_suggestions:
            recent_titles = [s.get("title", "") for s in recent_suggestions[:10]]
            if recent_titles:
                history_context += f"\nRECENT SUGGESTIONS (DO NOT REPEAT):\n"
                for title in recent_titles[:5]:
                    history_context += f"• {title}\n"
                history_context += f"IMPORTANT: Provide genuinely new suggestions that differ from recent ones.\n"

    # Build comprehensive prompt with all context
    prompt = f"""You are an AI assistant analyzing a detailed user workflow sequence to provide highly contextual suggestions.

{sequence_context}
{vision_context}
{history_context}

CONTEXT SIGNALS:
• Time: {request.context_signals.get('time_of_day', 'unknown')} on {request.context_signals.get('day_of_week', 'unknown')}
• Rapid switching: {request.context_signals.get('rapid_switching', False)}
• Multi-domain: {request.context_signals.get('multi_domain', False)}

ANALYSIS INSTRUCTIONS:
Analyze this complete workflow sequence using ALL available context:
1. Screen content from each app in the sequence (OCR text) - Note specific text, file names, error messages, URLs, function names, variable names, etc.
2. **Vision insights** from screenshots (UI elements, visual context, patterns) - Note specific UI states, button text, menu items, color schemes, layout patterns
3. User's historical patterns and preferences - Reference SPECIFIC past behaviors, tools used, proficiency levels
4. Keystroke patterns and tool usage - Note CONCRETE efficiency metrics and repetitive patterns
5. Knowledge graph insights about user expertise - Cite SPECIFIC skills and proficiency levels
6. The progression and timing of app transitions - Note EXACT sequences and durations
7. Multi-level context analysis of current state - Reference SPECIFIC activities and goals

CRITICAL REQUIREMENTS:
Provide ONLY 1 highly intelligent, NON-OBVIOUS suggestion that:
- **MUST be grounded in CONCRETE data from the context above** (cite specific OCR text, vision elements, historical patterns, or user proficiency)
- **AVOID generic/obvious advice** like "take breaks", "organize files", "use keyboard shortcuts" unless you can cite SPECIFIC evidence of inefficiency
- **Leverage SPECIFIC expertise from user history** (e.g., "Given your expert-level Python proficiency and your current TypeError in line 45...")
- **Reference CONCRETE visual or textual evidence** (e.g., "Your screenshot shows 12 browser tabs open with Stack Overflow, suggesting...")
- **Be hyper-specific to THIS moment** using actual data points from OCR, vision, or history
- **Demonstrate deep pattern analysis** - connect dots between multiple context sources
- Is personalized using ACTUAL demonstrated capabilities from knowledge graph
- Provides ACTIONABLE steps with specific tool names, shortcuts, or workflows the user ACTUALLY uses

If you cannot provide a suggestion grounded in CONCRETE, SPECIFIC data from the context, return empty suggestions array.

**QUALITY OVER QUANTITY**: Return NOTHING rather than generic advice. Your suggestion must cite at least 2-3 concrete data points from the context above (specific OCR text, vision elements, historical metrics, or skill proficiency levels).

Return JSON format:
{{
  "suggestions": [
    {{
      "type": "workflow_optimization|task_completion|context_switch|productivity|knowledge_application",
      "title": "Specific actionable suggestion based on full context",
      "content": {{
        "short_description": "One concise sentence (max 80 chars) summarizing the suggestion",
        "description": "Detailed explanation leveraging user history and sequence analysis",
        "action_steps": ["High-level step 1", "High-level step 2", "High-level step 3"],
        "expected_benefit": "What this will achieve for the user",
        "difficulty": "easy|medium|hard",
        "time_investment": "X minutes",
        "requires_detailed_guide": true,
        "tools_needed": ["App/tool name 1", "App/tool name 2"],
        "platforms": ["macOS", "Windows", "web"]
      }},
      "confidence": 0.8,
      "priority": "high|medium|low",
      "context_data": {{
        "triggers": ["Specific content or patterns that triggered this suggestion"],
        "relevant_apps": ["{request.app_sequence[0].appName if request.app_sequence else 'unknown'}"],
        "time_sensitive": true/false,
        "personalization_factors": ["User expertise/patterns that informed this suggestion"]
      }}
    }}
  ]
}}

If insufficient context for meaningful suggestions, return: {{"suggestions": []}}"""

    print("📝 BATCH PROMPT SENT TO LLM:")
    print("-" * 80)
    print(prompt)
    print("-" * 80)
    print("🔚 END BATCH PROMPT")
    print("="*80 + "\n")

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
            "app_transitions": [],
            "keystroke_patterns": []
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

        # Get top apps from app sessions (last 7 days)
        try:
            # Get recent app sessions from last 7 days
            recent_app_sessions = await execute_query(
                table="app_sessions",
                operation="select",
                filters={"user_id": str(user_id)},
                order_by="start_time",
                ascending=False,
                limit=100  # Get more sessions to calculate totals
            )

            if recent_app_sessions:
                app_totals = {}
                for session in recent_app_sessions:
                    app_name = session.get("app_name")
                    duration = session.get("duration_seconds", 0) or 0
                    minutes = max(1, duration // 60)  # Minimum 1 minute

                    app_totals[app_name] = app_totals.get(app_name, 0) + minutes

                history["top_apps"] = sorted(app_totals.items(), key=lambda x: x[1], reverse=True)[:5]
            else:
                # Fallback to usage metrics if app_sessions not available
                recent_metrics = await execute_query(
                    table="usage_metrics",
                    operation="select",
                    filters={"user_id": str(user_id)},
                    order_by="date",
                    ascending=False,
                    limit=7
                )

                if recent_metrics:
                    app_totals = {}
                    for metric in recent_metrics:
                        app_usage = metric.get("app_usage", {})
                        for app, minutes in app_usage.items():
                            app_totals[app] = app_totals.get(app, 0) + minutes

                    history["top_apps"] = sorted(app_totals.items(), key=lambda x: x[1], reverse=True)[:5]

        except Exception as e:
            pass
            history["top_apps"] = []

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
                    "weight": node.get("weight", 0),
                    "proficiency": "expert" if node.get("weight", 0) > 5.0 else "advanced" if node.get("weight", 0) > 3.0 else "intermediate" if node.get("weight", 0) > 1.5 else "beginner"
                } for node in skill_nodes
            ]

        # Get tool nodes from knowledge graph
        tool_nodes = await execute_query(
            table="knowledge_nodes",
            operation="select",
            filters={"user_id": str(user_id), "node_type": "tool"},
            order_by="weight",
            ascending=False,
            limit=10
        )

        if tool_nodes:
            history["tools"] = [
                {
                    "name": node.get("content", {}).get("name", ""),
                    "weight": node.get("weight", 0),
                    "proficiency": "expert" if node.get("weight", 0) > 5.0 else "advanced" if node.get("weight", 0) > 3.0 else "intermediate" if node.get("weight", 0) > 1.5 else "beginner",
                    "access_count": node.get("access_count", 0)
                } for node in tool_nodes
            ]

            # Get relationships for top tools to understand dependencies and connections
            try:
                top_tool_ids = [node.get("id") for node in tool_nodes[:5]]
                if top_tool_ids:
                    tool_relationships = await execute_query(
                        table="knowledge_relationships",
                        operation="select",
                        filters={"user_id": str(user_id)},
                        limit=20
                    )

                    if tool_relationships:
                        history["tool_relationships"] = [
                            {
                                "source": rel.get("source_node_id"),
                                "target": rel.get("target_node_id"),
                                "type": rel.get("relationship_type"),
                                "strength": rel.get("strength", 0.5)
                            } for rel in tool_relationships if rel.get("source_node_id") in top_tool_ids or rel.get("target_node_id") in top_tool_ids
                        ][:10]  # Limit to 10 relationships
            except Exception as rel_error:
                pass

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

        # Get recent keystroke patterns for efficiency context
        try:
            keystroke_patterns = await keystroke_analysis_service.get_user_keystroke_patterns(
                user_id=str(user_id),
                limit=5
            )

            if keystroke_patterns:
                history["keystroke_patterns"] = [
                    {
                        "app_context": pattern.get("app_context"),
                        "keystroke_count": pattern.get("keystroke_count"),
                        "sequence_duration": pattern.get("sequence_duration"),
                        "created_at": pattern.get("created_at"),
                        "efficiency_indicators": pattern.get("sequence_data", {}).get("patterns", {})
                    } for pattern in keystroke_patterns[:3]  # Last 3 patterns
                ]

            # Get overall efficiency insights
            efficiency_insights = await keystroke_analysis_service.get_efficiency_insights(
                user_id=str(user_id)
            )

            if efficiency_insights:
                history["keystroke_efficiency"] = {
                    "avg_efficiency": efficiency_insights.get("avg_efficiency_score", 0.5),
                    "total_analyses": efficiency_insights.get("total_analyses", 0),
                    "top_recommendations": efficiency_insights.get("common_recommendations", [])[:3],
                    "improvement_areas": efficiency_insights.get("improvement_areas", [])
                }
        except Exception as keystroke_error:
            pass
            history["keystroke_patterns"] = []
            history["keystroke_efficiency"] = {}

        return history

    except Exception as e:
        pass
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
        pass
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
                    pass
                    is_duplicate = True
                    break

            if not is_duplicate:
                filtered_suggestions.append(new_suggestion)

        pass
        return filtered_suggestions

    except Exception as e:
        pass
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
        pass
        return str(user_id)


async def save_context_data(request: AIContextRequest, suggestions: List[AISuggestionResponse], ai_request: AISuggestionRequest, supabase=None):
    """Save OCR context and AI suggestions to all relevant database tables"""
    try:
        # Ensure user profile exists
        await ensure_user_profile(request.user_id, supabase)

        # Create or get session (removed duplicate device_info that's now in app_sessions)
        session_data = {
            "user_id": str(request.user_id),
            "device_info": {
                "platform": request.current_session.get("platform", "unknown"),
                "device_id": request.current_session.get("device_id", "unknown")
                # ✅ Removed app_usage, session_duration_minutes - now tracked in app_sessions
            },
            "session_type": SessionType.GENERAL.value
        }

        session_result = await execute_query(
            table="user_sessions",
            operation="insert",
            data=session_data
        )
        session_id = session_result[0]["id"] if session_result else str(uuid4())

        pass

        # Get enhanced context analysis for app session
        current_context = await analyze_current_context(
            request.ocr_text,
            request.app_name
        )

        multi_level_context = await analyze_multi_level_context(
            request.ocr_text,
            request.app_name
        )

        # Additional processing would go here...

    except Exception as e:
        pass


@router.post("/ocr/queue/context")
async def queue_ocr_with_context(
    file: UploadFile = File(...),
    user_id: str = Form(""),
    session_id: str = Form(""),
    app_name: str = Form(""),
    window_title: str = Form(""),
    bundle_id: str = Form(""),
    priority: str = Form("normal"),
    session_context: str = Form("{}")
):
    """Queue OCR processing job with application context"""
    try:
        import json

        # Read image data
        image_data = await file.read()

        # Parse session context
        try:
            context_data = json.loads(session_context)
        except:
            context_data = {}

        # Generate session_id if not provided
        if not session_id or session_id.strip() == "":
            session_id = str(uuid4())

        # Build app context
        app_context = {
            "user_id": user_id or "unknown",
            "session_id": session_id,
            "app_name": app_name or "Unknown",
            "window_title": window_title or "",
            "bundle_id": bundle_id or "",
            "session_context": context_data
        }

        # Map priority string to enum
        priority_map = {
            "high": JobPriority.HIGH,
            "normal": JobPriority.NORMAL,
            "low": JobPriority.LOW
        }
        job_priority = priority_map.get(priority.lower(), JobPriority.NORMAL)

        # Queue the job
        job_id = await ocr_job_manager.queue_ocr_job(
            image_data=image_data,
            app_context=app_context,
            priority=job_priority
        )


        return {
            "job_id": job_id,
            "status": "queued",
            "message": "OCR job queued successfully"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch-context")
async def process_batch_context(request: BatchContextRequest):
    """Process batch context analysis with app sequence and generate suggestions"""
    try:

        # Get user history for personalization
        user_history = await get_user_history(UUID(request.user_id)) if request.user_id else None

        # Build the LLM prompt (no raw OCR context - only meaningful summaries in prompt)
        prompt = await build_batch_openai_prompt(request, user_history)

        # Call OpenAI
        client = get_openai_client()
        if not client:
            raise HTTPException(status_code=500, detail="OpenAI client not configured")


        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an AI productivity assistant analyzing user workflow sequences. Always respond with valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=1000,
            temperature=0.3,
            response_format={"type": "json_object"}
        )

        result = json.loads(response.choices[0].message.content)
        raw_suggestions = result.get("suggestions", [])

        print(f"💡 LLM SUGGESTION RESPONSE: {json.dumps(raw_suggestions, indent=2)}")


        # Transform suggestions to match frontend expected format
        suggestions = []
        for sug in raw_suggestions:
            # Get the content object from LLM response
            llm_content = sug.get("content", {})

            transformed = {
                "type": sug.get("type", "general"),
                "title": sug.get("title", ""),
                "content": {
                    "short_description": llm_content.get("short_description", sug.get("title", "")),
                    "description": llm_content.get("description", sug.get("description", "")),
                    "expected_benefit": llm_content.get("expected_benefit", ""),
                    "difficulty": llm_content.get("difficulty", "medium"),
                    "time_investment": llm_content.get("time_investment", "5-15 minutes"),
                    "platforms": llm_content.get("platforms", []),
                    "tools_needed": llm_content.get("tools_needed", []),
                    "action_steps": llm_content.get("action_steps", []),
                    "requires_detailed_guide": llm_content.get("requires_detailed_guide", False)
                },
                "confidence_score": sug.get("confidence", 0.7),
                "priority": sug.get("priority", "medium"),
                "context_data": sug.get("context_data", {
                    "triggers": sug.get("triggers", []),
                    "relevant_apps": sug.get("relevant_apps", []),
                    "time_sensitive": sug.get("time_sensitive", False),
                    "personalization_factors": sug.get("personalization_factors", [])
                })
            }
            suggestions.append(transformed)


        # Filter duplicates if user history exists
        if user_history:
            suggestions = await filter_duplicate_suggestions(suggestions, user_history)

        # 💾 SAVE SUGGESTIONS TO DATABASE
        print(f"\n{'='*60}")
        print(f"💾 [AI] SAVING {len(suggestions)} SUGGESTIONS TO DATABASE")
        print(f"   User ID: {request.user_id}")
        print(f"   Session ID: {request.session_id}")

        saved_suggestions = []
        for i, suggestion in enumerate(suggestions):
            try:
                # Prepare suggestion_content with title included
                suggestion_content = suggestion.get("content", {})
                if "title" not in suggestion_content and "title" in suggestion:
                    suggestion_content["title"] = suggestion.get("title", "")

                # Convert priority from string to integer (1-10 scale)
                priority_str = suggestion.get("priority", "medium")
                priority_map = {"high": 8, "medium": 5, "low": 2}
                priority_int = priority_map.get(priority_str, 5)

                # Map LLM suggestion types to valid database types
                # DB allows: 'productivity', 'workflow', 'automation', 'optimization', 'learning', 'reminder', 'insight'
                llm_type = suggestion.get("type", "productivity")
                type_mapping = {
                    "workflow_optimization": "workflow",
                    "task_completion": "productivity",
                    "context_switch": "productivity",
                    "knowledge_application": "learning",
                    "efficiency": "optimization",
                    "general": "productivity"
                }
                # Map or use the type directly if it's already valid
                suggestion_type = type_mapping.get(llm_type, llm_type)

                suggestion_data = {
                    "user_id": request.user_id,
                    "session_ids": [request.session_id],  # Array of session IDs
                    "suggestion_type": suggestion_type,  # Mapped to valid DB type
                    "suggestion_content": suggestion_content,  # JSONB with title inside
                    "confidence_score": suggestion.get("confidence_score", 0.7),
                    "priority": priority_int,  # INTEGER 1-10
                    "context_data": suggestion.get("context_data", {}),
                    "status": "pending"
                }

                print(f"   [{i+1}] Saving: {suggestion.get('title', 'Untitled')}")

                result = await execute_query(
                    table="ai_suggestions",
                    operation="insert",
                    data=suggestion_data
                )

                if result:
                    print(f"       ✅ Saved to DB with ID: {result[0].get('id', 'unknown')}")
                    saved_suggestions.append(result[0])
                else:
                    print(f"       ❌ Failed to save (no result)")

            except Exception as save_error:
                print(f"       ❌ Error saving suggestion: {save_error}")
                import traceback
                traceback.print_exc()

        print(f"\n   📊 Summary: {len(saved_suggestions)}/{len(suggestions)} suggestions saved")
        print(f"{'='*60}\n")

        return {
            "suggestions": suggestions,
            "sequence_id": request.sequence_metadata.sequence_id,
            "request_type": request.request_type,
            "saved_count": len(saved_suggestions)
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))




@router.get("/ocr/job/{job_id}")
async def get_ocr_job_status(job_id: str):
    """Get OCR job status by ID"""
    try:
        job = await ocr_job_manager.get_job_status(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ocr/queue/stats")
async def get_ocr_queue_stats():
    """Get OCR queue statistics"""
    try:
        stats = await ocr_job_manager.get_queue_stats()
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/keystroke-analysis")
async def process_keystroke_analysis(request: dict):
    """Process keystroke sequence and analyze patterns"""
    try:
        user_id = request.get('user_id')
        sequence_data = request.get('sequence_data', {})
        session_context = request.get('session_context', {})

        if not user_id or not sequence_data:
            raise HTTPException(status_code=400, detail="user_id and sequence_data required")

        result = await keystroke_analysis_service.process_keystroke_sequence(
            user_id, sequence_data, session_context
        )

        return result
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
