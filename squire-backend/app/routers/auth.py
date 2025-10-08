"""
Authentication API endpoints
"""
from fastapi import APIRouter, HTTPException, status, Request, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Dict, Any
from app.services.auth_service import auth_service
from app.middleware.auth import jwt_bearer, get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


# Request/Response Models
class SignUpRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    name: Optional[str] = None
    timezone: Optional[str] = "UTC"


class SignInRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class OAuthRequest(BaseModel):
    provider: str = Field(..., description="OAuth provider (google, github, etc.)")
    redirect_to: Optional[str] = None


class OAuthCallbackRequest(BaseModel):
    code: str
    provider: str


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int
    user: Dict[str, Any]


class MessageResponse(BaseModel):
    message: str
    success: bool = True


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def sign_up(request: SignUpRequest):
    """
    Register a new user account

    - **email**: User's email address
    - **password**: Password (min 6 characters)
    - **name**: Optional display name
    - **timezone**: User's timezone (default: UTC)
    """
    try:
        user_metadata = {}
        if request.name:
            user_metadata["name"] = request.name
        if request.timezone:
            user_metadata["timezone"] = request.timezone

        result = await auth_service.sign_up(
            email=request.email,
            password=request.password,
            user_metadata=user_metadata
        )

        if not result["access_token"]:
            # User created but email confirmation required
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content={
                    "message": "Please check your email to confirm your account",
                    "success": True,
                    "requires_confirmation": True
                }
            )

        return AuthResponse(
            access_token=result["access_token"],
            refresh_token=result["refresh_token"],
            token_type="Bearer",
            expires_in=3600,  # 1 hour
            user={
                "id": result["user"].id,
                "email": result["user"].email,
                "metadata": result["user"].user_metadata
            }
        )

    except Exception as e:
        if "already registered" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already registered"
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/signin", response_model=AuthResponse)
async def sign_in(request: SignInRequest):
    """
    Sign in with email and password

    - **email**: User's email address
    - **password**: User's password
    """
    try:
        result = await auth_service.sign_in(
            email=request.email,
            password=request.password
        )

        return AuthResponse(
            access_token=result["access_token"],
            refresh_token=result["refresh_token"],
            token_type="Bearer",
            expires_in=3600,  # 1 hour
            user={
                "id": result["user"].id,
                "email": result["user"].email,
                "metadata": result["user"].user_metadata
            }
        )

    except Exception as e:
        if "invalid" in str(e).lower() or "credentials" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/signout", response_model=MessageResponse, dependencies=[Depends(jwt_bearer)])
async def sign_out(request: Request):
    """
    Sign out the current user

    Requires authentication
    """
    try:
        token = request.state.token
        await auth_service.sign_out(token)

        return MessageResponse(
            message="Successfully signed out",
            success=True
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/refresh", response_model=AuthResponse)
async def refresh_token(request: RefreshTokenRequest):
    """
    Refresh access token using refresh token

    - **refresh_token**: Valid refresh token
    """
    try:
        result = await auth_service.refresh_token(request.refresh_token)

        # Get user details with new token
        user = await auth_service.get_user(result["access_token"])

        return AuthResponse(
            access_token=result["access_token"],
            refresh_token=result["refresh_token"],
            token_type="Bearer",
            expires_in=3600,  # 1 hour
            user={
                "id": user["id"],
                "email": user["email"],
                "metadata": user["metadata"]
            }
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )


@router.get("/me", dependencies=[Depends(jwt_bearer)])
async def get_current_user_info(user: Dict[str, Any] = Depends(get_current_user)):
    """
    Get current user information

    Requires authentication
    """
    return {
        "id": user["id"],
        "email": user["email"],
        "profile": user.get("profile"),
        "metadata": user.get("metadata")
    }


@router.post("/oauth/signin")
async def oauth_sign_in(request: OAuthRequest):
    """
    Initiate OAuth sign-in flow

    - **provider**: OAuth provider (google, github, etc.)
    - **redirect_to**: Optional URL to redirect after authentication
    """
    try:
        result = await auth_service.sign_in_with_oauth(
            provider=request.provider,
            redirect_to=request.redirect_to
        )

        return {
            "url": result["url"],
            "provider": result["provider"]
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"OAuth sign-in failed: {str(e)}"
        )


@router.post("/oauth/callback", response_model=AuthResponse)
async def oauth_callback(request: OAuthCallbackRequest):
    """
    Handle OAuth callback and exchange code for tokens

    - **code**: OAuth authorization code
    - **provider**: OAuth provider name
    """
    try:
        result = await auth_service.handle_oauth_callback(
            code=request.code,
            provider=request.provider
        )

        return AuthResponse(
            access_token=result["access_token"],
            refresh_token=result["refresh_token"],
            token_type="Bearer",
            expires_in=3600,  # 1 hour
            user={
                "id": result["user"].id,
                "email": result["user"].email,
                "metadata": result["user"].user_metadata
            }
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"OAuth callback failed: {str(e)}"
        )


@router.get("/health")
async def health_check():
    """
    Check authentication service health
    """
    return {
        "status": "healthy",
        "service": "authentication",
        "features": {
            "email_auth": True,
            "oauth": True,
            "jwt": True,
            "refresh_tokens": True
        }
    }