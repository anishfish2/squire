from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from uuid import UUID
from app.core.database import execute_query


class AppSessionService:

    @staticmethod
    async def create_or_update_app_session(
        user_id: str,
        session_id: str,
        app_name: str,
        window_title: str = "",
        bundle_id: str = "",
        context_type: str = "",
        domain: str = "",
        activity_summary: str = ""
    ) -> str:
        try:
            active_sessions = await execute_query(
                table="app_sessions",
                operation="select",
                filters={
                    "user_id": user_id,
                    "session_id": session_id,
                    "app_name": app_name,
                    "is_active": True
                },
                limit=1
            )

            current_time = datetime.now()

            if active_sessions:
                app_session_id = active_sessions[0]["id"]

                update_data = {
                    "window_title": window_title,
                    "bundle_id": bundle_id,
                    "last_activity": current_time.isoformat(),
                    "updated_at": current_time.isoformat()
                }

                if context_type:
                    update_data["context_type"] = context_type
                if domain:
                    update_data["domain"] = domain
                if activity_summary:
                    update_data["activity_summary"] = activity_summary

                await execute_query(
                    table="app_sessions",
                    operation="update",
                    data=update_data,
                    filters={"id": app_session_id}
                )

                return app_session_id

            else:
                app_session_data = {
                    "user_id": user_id,
                    "session_id": session_id,
                    "app_name": app_name,
                    "window_title": window_title,
                    "bundle_id": bundle_id,
                    "context_type": context_type or "general",
                    "domain": domain or "general",
                    "activity_summary": activity_summary,
                    "start_time": current_time.isoformat(),
                    "last_activity": current_time.isoformat(),
                    "is_active": True
                }

                result = await execute_query(
                    table="app_sessions",
                    operation="insert",
                    data=app_session_data
                )

                app_session_id = result[0]["id"] if result else None
                return app_session_id

        except Exception as e:
            return None

    @staticmethod
    async def end_app_session(app_session_id: str, reason: str = "manual") -> bool:
        try:
            current_time = datetime.now()

            await execute_query(
                table="app_sessions",
                operation="update",
                data={
                    "end_time": current_time.isoformat(),
                    "is_active": False,
                    "transition_reason": reason,
                    "updated_at": current_time.isoformat()
                },
                filters={"id": app_session_id}
            )

            return True

        except Exception as e:
            return False

    @staticmethod
    async def end_inactive_sessions(user_id: str, session_id: str, timeout_minutes: int = 5) -> int:
        try:
            cutoff_time = datetime.now() - timedelta(minutes=timeout_minutes)

            inactive_sessions = await execute_query(
                table="app_sessions",
                operation="select",
                filters={
                    "user_id": user_id,
                    "session_id": session_id,
                    "is_active": True
                }
            )

            ended_count = 0
            for session in inactive_sessions or []:
                last_activity = datetime.fromisoformat(session["last_activity"])
                if last_activity < cutoff_time:
                    await AppSessionService.end_app_session(
                        session["id"],
                        reason="timeout"
                    )
                    ended_count += 1

            return ended_count

        except Exception as e:
            return 0

    @staticmethod
    async def get_active_app_sessions(user_id: str, session_id: str = None) -> List[Dict]:
        try:
            filters = {
                "user_id": user_id,
                "is_active": True
            }

            if session_id:
                filters["session_id"] = session_id

            sessions = await execute_query(
                table="app_sessions",
                operation="select",
                filters=filters,
                order_by="last_activity",
                ascending=False
            )

            return sessions or []

        except Exception as e:
            return []

    @staticmethod
    async def get_app_usage_summary(user_id: str, date: str = None) -> Dict[str, Any]:
        try:
            if not date:
                date = datetime.now().date().isoformat()

            sessions = await execute_query(
                table="app_sessions",
                operation="select",
                filters={
                    "user_id": user_id
                }
            )

            if not sessions:
                return {"date": date, "total_apps": 0, "total_minutes": 0, "app_breakdown": {}}

            app_usage = {}
            total_minutes = 0

            for session in sessions:
                session_date = session["start_time"][:10]
                if session_date != date:
                    continue

                app_name = session["app_name"]
                duration = session.get("duration_seconds", 0) or 0
                minutes = max(1, duration // 60)

                app_usage[app_name] = app_usage.get(app_name, 0) + minutes
                total_minutes += minutes

            return {
                "date": date,
                "total_apps": len(app_usage),
                "total_minutes": total_minutes,
                "app_breakdown": dict(sorted(app_usage.items(), key=lambda x: x[1], reverse=True))
            }

        except Exception as e:
            return {"date": date, "total_apps": 0, "total_minutes": 0, "app_breakdown": {}}

    @staticmethod
    async def get_recent_app_context(user_id: str, limit: int = 5) -> List[Dict]:
        try:
            sessions = await execute_query(
                table="app_sessions",
                operation="select",
                filters={"user_id": user_id},
                order_by="start_time",
                ascending=False,
                limit=limit
            )

            contexts = []
            for session in sessions or []:
                context = {
                    "app_name": session["app_name"],
                    "context_type": session.get("context_type", "general"),
                    "domain": session.get("domain", "general"),
                    "activity_summary": session.get("activity_summary", ""),
                    "duration_minutes": (session.get("duration_seconds") or 0) // 60,
                    "start_time": session["start_time"]
                }
                contexts.append(context)

            return contexts

        except Exception as e:
            return []

    @staticmethod
    async def update_session_context(
        app_session_id: str,
        context_type: str = None,
        domain: str = None,
        activity_summary: str = None
    ) -> bool:
        try:
            update_data = {"updated_at": datetime.now().isoformat()}

            if context_type:
                update_data["context_type"] = context_type
            if domain:
                update_data["domain"] = domain
            if activity_summary:
                update_data["activity_summary"] = activity_summary

            await execute_query(
                table="app_sessions",
                operation="update",
                data=update_data,
                filters={"id": app_session_id}
            )

            return True

        except Exception as e:
            return False