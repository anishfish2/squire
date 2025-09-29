"""
LLM-Driven Knowledge Analysis Service with Multi-Level Context Tracking
"""
import json
from typing import Dict, List, Set, Any, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class ContentAnalysisResult:
    concepts: Set[str]
    tools: Set[str]
    current_activity: str
    context_type: str  # "work", "learning", "debugging", "creating", etc.
    domain: str
    confidence_score: float


@dataclass
class ContextLevel:
    micro: str      # immediate activity (5-30 seconds)
    task: str       # current task (minutes)
    app: str        # app-level work (minutes to hours)
    session: str    # session theme (hours)


class KnowledgeAnalysisService:
    """LLM-powered service for understanding user context at multiple levels"""

    def __init__(self, openai_client=None):
        self.openai_client = openai_client

    def analyze_current_context(self,
                               ocr_lines: List[str],
                               app_context: str = "",
                               recent_history: List[str] = None) -> ContentAnalysisResult:
        """
        Use LLM to understand what the user is currently doing
        """
        if not ocr_lines or not self.openai_client:
            return self._empty_result()

        prompt = self._build_context_prompt(ocr_lines, app_context, recent_history)

        try:
            response = self.openai_client.chat.completions.create(
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

            return ContentAnalysisResult(
                concepts=set(analysis.get('concepts', [])),
                tools=set(analysis.get('tools', [])),
                current_activity=analysis.get('current_activity', 'general_work'),
                context_type=analysis.get('context_type', 'work'),
                domain=analysis.get('domain', 'general'),
                confidence_score=analysis.get('confidence_score', 0.5)
            )

        except Exception as e:
            print(f"Error in context analysis: {e}")
            return self._empty_result()

    def analyze_multi_level_context(self,
                                   current_ocr: List[str],
                                   app_context: str,
                                   recent_app_history: List[Dict],
                                   session_history: List[Dict]) -> ContextLevel:
        """
        Analyze context at multiple time scales using LLM
        """
        if not self.openai_client:
            return ContextLevel("unknown", "unknown", "unknown", "unknown")

        prompt = self._build_multi_level_prompt(
            current_ocr, app_context, recent_app_history, session_history
        )

        try:
            response = self.openai_client.chat.completions.create(
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

            return ContextLevel(
                micro=analysis.get('micro_context', 'working'),
                task=analysis.get('task_context', 'general task'),
                app=analysis.get('app_context', 'using application'),
                session=analysis.get('session_context', 'work session')
            )

        except Exception as e:
            print(f"Error in multi-level context analysis: {e}")
            return ContextLevel("unknown", "unknown", "unknown", "unknown")

    def _build_context_prompt(self,
                             ocr_lines: List[str],
                             app_context: str,
                             recent_history: List[str] = None) -> str:
        """Build prompt to understand current user context"""

        content = '\n'.join(ocr_lines)
        history_context = ""
        if recent_history:
            history_context = f"\nRecent activities: {', '.join(recent_history[-3:])}"

        prompt = f"""Analyze what the user is currently doing based on their screen content.

CURRENT SCREEN:
App: {app_context or 'Unknown'}
Content:
{content}
{history_context}

Return JSON with immediate context:
{{
  "current_activity": "brief description of immediate activity",
  "context_type": "work|learning|debugging|creating|researching|communicating|planning|analyzing",
  "domain": "general field or subject area",
  "concepts": ["relevant concept1", "concept2"],
  "tools": ["tool1", "tool2"],
  "confidence_score": 0.8
}}"""

        return prompt

    def _build_multi_level_prompt(self,
                                 current_ocr: List[str],
                                 app_context: str,
                                 recent_app_history: List[Dict],
                                 session_history: List[Dict]) -> str:
        """Build prompt for multi-level context analysis"""

        current_content = '\n'.join(current_ocr)

        # Build app-level context
        app_activities = []
        if recent_app_history:
            for item in recent_app_history[-5:]:
                if item.get('activity'):
                    app_activities.append(item['activity'])

        # Build session-level context
        session_apps = []
        session_themes = []
        if session_history:
            for item in session_history[-10:]:
                if item.get('app_name'):
                    session_apps.append(item['app_name'])
                if item.get('theme'):
                    session_themes.append(item['theme'])

        prompt = f"""Analyze user context at multiple time scales.

CURRENT MOMENT:
App: {app_context}
Screen: {current_content}

RECENT APP ACTIVITY (last few minutes):
{', '.join(app_activities) if app_activities else 'No recent app history'}

SESSION OVERVIEW (this session):
Apps used: {', '.join(set(session_apps)) if session_apps else 'Limited session data'}
Themes: {', '.join(set(session_themes)) if session_themes else 'No theme data'}

ANALYSIS TASK:
Provide context understanding at 4 levels:

1. MICRO (immediate 5-30 seconds): What are they doing right now?
2. TASK (current minutes): What task/goal are they working on?
3. APP (app session): What are they accomplishing in this app?
4. SESSION (hours): What's the overarching theme of this work session?

Return JSON:
{{
  "micro_context": "immediate action (e.g., 'reading error message', 'typing code', 'reviewing document')",
  "task_context": "current task (e.g., 'debugging authentication issue', 'writing project proposal')",
  "app_context": "app-level work (e.g., 'developing new feature', 'data analysis in Excel')",
  "session_context": "session theme (e.g., 'product development work', 'financial planning session')",
  "context_transitions": {{
    "task_changed": true/false,
    "new_workflow": true/false
  }}
}}"""

        return prompt

    def build_enhanced_knowledge_context(self,
                                       current_analysis: ContentAnalysisResult,
                                       context_levels: ContextLevel,
                                       user_knowledge_graph: Dict = None) -> str:
        """Build comprehensive context for LLM suggestions using all knowledge sources"""

        context_parts = []

        # Multi-level context
        context_parts.append("CURRENT CONTEXT:")
        context_parts.append(f"• Right now: {context_levels.micro}")
        context_parts.append(f"• Current task: {context_levels.task}")
        context_parts.append(f"• In this app: {context_levels.app}")
        context_parts.append(f"• Session theme: {context_levels.session}")

        # Immediate analysis
        context_parts.append(f"\nIMMEDIATE ACTIVITY:")
        context_parts.append(f"• Doing: {current_analysis.current_activity}")
        context_parts.append(f"• Type: {current_analysis.context_type}")

        if current_analysis.concepts:
            context_parts.append(f"• Concepts: {', '.join(list(current_analysis.concepts)[:3])}")

        if current_analysis.tools:
            context_parts.append(f"• Tools: {', '.join(list(current_analysis.tools)[:3])}")

        # Knowledge graph insights
        if user_knowledge_graph:
            context_parts.append(f"\nUSER KNOWLEDGE PROFILE:")

            # Relevant tools and skills
            relevant_tools = user_knowledge_graph.get('frequent_tools', [])[:4]
            if relevant_tools:
                context_parts.append(f"• Familiar tools: {', '.join(relevant_tools)}")

            # Domain expertise
            primary_domain = user_knowledge_graph.get('primary_domain')
            if primary_domain and primary_domain != 'general':
                context_parts.append(f"• Domain expertise: {primary_domain}")

            # Recent patterns
            recent_patterns = user_knowledge_graph.get('recent_workflow_patterns', [])[:3]
            if recent_patterns:
                context_parts.append(f"• Recent workflows: {', '.join(recent_patterns)}")

        return "\n".join(context_parts)

    def detect_context_transitions(self,
                                 current_context: ContextLevel,
                                 previous_context: ContextLevel = None) -> Dict[str, bool]:
        """Detect when user transitions between different context levels"""

        if not previous_context:
            return {"new_session": True}

        transitions = {
            "task_changed": current_context.task != previous_context.task,
            "app_workflow_changed": current_context.app != previous_context.app,
            "session_theme_changed": current_context.session != previous_context.session,
            "micro_activity_changed": current_context.micro != previous_context.micro
        }

        return transitions

    def _empty_result(self) -> ContentAnalysisResult:
        """Return empty analysis result"""
        return ContentAnalysisResult(
            concepts=set(),
            tools=set(),
            current_activity='unknown',
            context_type='work',
            domain='general',
            confidence_score=0.0
        )