"""
JWT Authentication middleware for protected routes
"""
from typing import Optional, Dict, Any
from fastapi import Request, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.services.auth_service import auth_service


class JWTBearer(HTTPBearer):
    """
    JWT Bearer token authentication
    """
    def __init__(self, auto_error: bool = True):
        super(JWTBearer, self).__init__(auto_error=auto_error)

    async def __call__(self, request: Request) -> Optional[str]:
        credentials: HTTPAuthorizationCredentials = await super().__call__(request)
        if credentials:
            if not credentials.scheme == "Bearer":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid authentication scheme."
                )
            token = credentials.credentials
            if not await self.verify_jwt(token):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid token or expired token."
                )
            # Store user info in request state for use in routes
            user = await auth_service.get_user(token)
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid token or expired token."
                )
            request.state.user = user
            request.state.user_id = user["id"]
            request.state.token = token
            return token
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid authorization code."
            )

    async def verify_jwt(self, token: str) -> bool:
        """
        Verify if the JWT token is valid

        Args:
            token: JWT token string

        Returns:
            True if valid, False otherwise
        """
        payload = await auth_service.verify_token(token)
        return payload is not None


class OptionalJWTBearer(JWTBearer):
    """
    Optional JWT Bearer token authentication
    Allows requests without token but extracts user info if token is present
    """
    def __init__(self):
        super().__init__(auto_error=False)

    async def __call__(self, request: Request) -> Optional[str]:
        try:
            credentials: HTTPAuthorizationCredentials = await super(HTTPBearer, self).__call__(request)
            if credentials and credentials.scheme == "Bearer":
                token = credentials.credentials
                if await self.verify_jwt(token):
                    # Store user info in request state
                    user = await auth_service.get_user(token)
                    if user:
                        request.state.user = user
                        request.state.user_id = user["id"]
                        request.state.token = token
                    return token
        except Exception:
            pass

        # No token or invalid token - set user as None
        request.state.user = None
        request.state.user_id = None
        request.state.token = None
        return None


async def get_current_user(request: Request) -> Dict[str, Any]:
    """
    Get the current authenticated user from request state

    Args:
        request: FastAPI request object

    Returns:
        User information

    Raises:
        HTTPException if user not authenticated
    """
    if not hasattr(request.state, 'user') or request.state.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    return request.state.user


async def get_current_user_id(request: Request) -> str:
    """
    Get the current authenticated user's ID from request state

    Args:
        request: FastAPI request object

    Returns:
        User ID string

    Raises:
        HTTPException if user not authenticated
    """
    if not hasattr(request.state, 'user_id') or request.state.user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    return request.state.user_id


async def get_optional_user(request: Request) -> Optional[Dict[str, Any]]:
    """
    Get the current user if authenticated, None otherwise

    Args:
        request: FastAPI request object

    Returns:
        User information or None
    """
    if hasattr(request.state, 'user'):
        return request.state.user
    return None


async def get_optional_user_id(request: Request) -> Optional[str]:
    """
    Get the current user ID if authenticated, None otherwise

    Args:
        request: FastAPI request object

    Returns:
        User ID string or None
    """
    if hasattr(request.state, 'user_id'):
        return request.state.user_id
    return None


# Export instances
jwt_bearer = JWTBearer()
optional_jwt_bearer = OptionalJWTBearer()