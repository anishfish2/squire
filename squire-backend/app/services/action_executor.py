"""
Action Executor Service
Handles execution of actions from the action queue
"""
from typing import Dict, Any, Optional, List
from uuid import UUID
from datetime import datetime

from app.core.database import supabase
from app.agents.base_agent import BaseAgent, ActionResult, AgentError
from app.agents.gsuite.gmail_agent import GmailAgent
from app.agents.gsuite.calendar_agent import CalendarAgent


class ActionExecutor:
    """
    Central service for executing actions
    Routes actions to appropriate agents and manages execution flow
    """

    def __init__(self):
        self.agent_registry: Dict[str, type] = {
            # Gmail actions
            "gmail_send": GmailAgent,
            "gmail_create_draft": GmailAgent,
            "gmail_search": GmailAgent,

            # Calendar actions
            "calendar_create_event": CalendarAgent,
            "calendar_update_event": CalendarAgent,
            "calendar_delete_event": CalendarAgent,
            "calendar_get_availability": CalendarAgent,
        }

    async def execute_direct_actions(
        self,
        user_id: str,
        action_steps: List[Dict[str, Any]],
        suggestion_id: Optional[str] = None
    ) -> List[ActionResult]:
        """
        Execute a list of action steps directly (Flow A)

        Args:
            user_id: User ID executing the actions
            action_steps: List of action step definitions
            suggestion_id: Optional suggestion ID that generated these actions

        Returns:
            List of ActionResult objects
        """
        results = []

        for step in action_steps:
            try:
                # Queue the action
                action_id = await self._queue_action(
                    user_id=user_id,
                    suggestion_id=suggestion_id,
                    action_type=step.get("action_type"),
                    action_params=step.get("action_params", {}),
                    requires_approval=step.get("requires_approval", True),
                    priority=step.get("priority", 5)
                )

                # If requires approval, wait for it
                if step.get("requires_approval", True):
                    print(f"⏳ Action {action_id} requires approval, waiting...")
                    # In production, this would wait via WebSocket/polling
                    # For now, we'll assume immediate approval for testing
                    await self._approve_action(action_id, user_id)

                # Execute the action
                result = await self._execute_action(action_id, user_id)
                results.append(result)

            except Exception as e:
                print(f"❌ Error executing action step: {e}")
                results.append(ActionResult(
                    success=False,
                    error=str(e)
                ))

        return results

    async def _queue_action(
        self,
        user_id: str,
        action_type: str,
        action_params: Dict[str, Any],
        suggestion_id: Optional[str] = None,
        requires_approval: bool = True,
        priority: int = 5
    ) -> str:
        """Queue an action in the database"""
        try:
            # Call the Postgres function
            result = supabase.rpc(
                "queue_action",
                {
                    "p_user_id": user_id,
                    "p_suggestion_id": suggestion_id,
                    "p_action_type": action_type,
                    "p_action_data": action_params,
                    "p_requires_approval": requires_approval,
                    "p_priority": priority
                }
            ).execute()

            action_id = result.data
            print(f"✅ Queued action {action_id} of type {action_type}")
            return action_id

        except Exception as e:
            print(f"❌ Error queuing action: {e}")
            raise

    async def _approve_action(self, action_id: str, user_id: str) -> bool:
        """Approve a pending action"""
        try:
            result = supabase.rpc(
                "approve_action",
                {
                    "p_action_id": action_id,
                    "p_user_id": user_id
                }
            ).execute()

            print(f"✅ Action {action_id} approved")
            return result.data

        except Exception as e:
            print(f"❌ Error approving action: {e}")
            return False

    async def _execute_action(self, action_id: str, user_id: str) -> ActionResult:
        """Execute a queued action"""
        try:
            # Get action details from database
            action = supabase.table("action_queue")\
                .select("*")\
                .eq("id", action_id)\
                .eq("user_id", user_id)\
                .single()\
                .execute()

            action_data = action.data
            action_type = action_data["action_type"]
            action_params = action_data["action_data"]

            # Update status to executing
            supabase.rpc(
                "update_action_status",
                {
                    "p_action_id": action_id,
                    "p_new_status": "executing"
                }
            ).execute()

            # Get appropriate agent
            agent = await self._get_agent(action_type, user_id)

            if not agent:
                raise ValueError(f"No agent found for action type: {action_type}")

            # Execute via agent
            print(f"🚀 Executing action {action_id} via {agent.service_name}")
            result = await agent.execute(action_type, action_params)

            # Update action status
            if result.success:
                supabase.rpc(
                    "update_action_status",
                    {
                        "p_action_id": action_id,
                        "p_new_status": "completed",
                        "p_result": result.to_dict()
                    }
                ).execute()
                print(f"✅ Action {action_id} completed successfully")
            else:
                supabase.rpc(
                    "update_action_status",
                    {
                        "p_action_id": action_id,
                        "p_new_status": "failed",
                        "p_error": result.error
                    }
                ).execute()
                print(f"❌ Action {action_id} failed: {result.error}")

            return result

        except Exception as e:
            print(f"❌ Error executing action {action_id}: {e}")

            # Update action status to failed
            try:
                supabase.rpc(
                    "update_action_status",
                    {
                        "p_action_id": action_id,
                        "p_new_status": "failed",
                        "p_error": str(e)
                    }
                ).execute()
            except:
                pass

            return ActionResult(success=False, error=str(e))

    async def _get_agent(self, action_type: str, user_id: str) -> Optional[BaseAgent]:
        """
        Get the appropriate agent for an action type

        Args:
            action_type: Type of action (e.g., 'gmail_send', 'calendar_create_event')
            user_id: User ID for getting OAuth tokens

        Returns:
            Initialized agent instance or None
        """
        agent_class = self.agent_registry.get(action_type)

        if not agent_class:
            return None

        # Get user's OAuth tokens for this service
        service_name = action_type.split("_")[0]  # Extract 'gmail' from 'gmail_send'
        credentials = await self._get_user_credentials(user_id, service_name)

        # Initialize and return agent
        return agent_class(user_id=user_id, credentials=credentials)

    async def _get_user_credentials(
        self,
        user_id: str,
        service_name: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get user's OAuth credentials for a service

        Args:
            user_id: User ID
            service_name: Service name (e.g., 'gmail', 'calendar')

        Returns:
            Credentials dict or None
        """
        try:
            # Map service names to provider names in user_oauth_tokens table
            provider_map = {
                "gmail": "google",
                "calendar": "google",
                "drive": "google",
                "notion": "notion",
                "slack": "slack"
            }

            provider = provider_map.get(service_name)
            if not provider:
                print(f"⚠️ No provider mapping for service: {service_name}")
                return None

            # Query user_oauth_tokens table
            result = supabase.table("user_oauth_tokens")\
                .select("access_token, refresh_token, expires_at, token_type, scopes")\
                .eq("user_id", user_id)\
                .eq("provider", provider)\
                .order("created_at", desc=True)\
                .limit(1)\
                .execute()

            if result.data and len(result.data) > 0:
                token_data = result.data[0]
                print(f"✅ Found credentials for {service_name} (provider: {provider})")
                return token_data
            else:
                print(f"⚠️ No credentials found for user {user_id}, provider {provider}")
                return None

        except Exception as e:
            print(f"❌ Error getting credentials: {e}")
            return None


# Global instance
action_executor = ActionExecutor()
