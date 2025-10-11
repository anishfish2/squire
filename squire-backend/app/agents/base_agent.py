"""
Base Agent Class
All action agents inherit from this class
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from datetime import datetime


class ActionResult:
    """Result of an action execution"""
    def __init__(
        self,
        success: bool,
        data: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.success = success
        self.data = data or {}
        self.error = error
        self.metadata = metadata or {}
        self.timestamp = datetime.utcnow().isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "data": self.data,
            "error": self.error,
            "metadata": self.metadata,
            "timestamp": self.timestamp
        }


class BaseAgent(ABC):
    """
    Abstract base class for all action agents

    Each agent is responsible for executing actions for a specific service
    (Gmail, Calendar, Notion, Computer Use, etc.)
    """

    def __init__(self, user_id: str, credentials: Optional[Dict[str, Any]] = None):
        """
        Initialize the agent

        Args:
            user_id: User ID this agent is operating for
            credentials: OAuth tokens or API keys for the service
        """
        self.user_id = user_id
        self.credentials = credentials
        self.service_name = self.__class__.__name__.replace("Agent", "").lower()

    @abstractmethod
    async def execute(self, action_type: str, params: Dict[str, Any]) -> ActionResult:
        """
        Execute an action

        Args:
            action_type: Type of action to execute (e.g., 'send_email', 'create_event')
            params: Parameters for the action

        Returns:
            ActionResult with success status and data/error
        """
        pass

    async def validate_params(self, action_type: str, params: Dict[str, Any]) -> bool:
        """
        Validate action parameters before execution

        Args:
            action_type: Type of action
            params: Parameters to validate

        Returns:
            True if valid, raises ValueError if not
        """
        return True

    def is_authenticated(self) -> bool:
        """Check if agent has valid credentials"""
        return self.credentials is not None

    async def refresh_credentials(self) -> bool:
        """
        Refresh OAuth tokens if needed
        Override in subclasses that use OAuth
        """
        return True

    def log(self, message: str, level: str = "info"):
        """Log agent activity"""
        timestamp = datetime.utcnow().isoformat()
        print(f"[{timestamp}] [{self.service_name.upper()}] [{level.upper()}] {message}")


class AgentError(Exception):
    """Base exception for agent errors"""
    pass


class AuthenticationError(AgentError):
    """Raised when agent authentication fails"""
    pass


class ValidationError(AgentError):
    """Raised when action parameters are invalid"""
    pass


class ExecutionError(AgentError):
    """Raised when action execution fails"""
    pass
