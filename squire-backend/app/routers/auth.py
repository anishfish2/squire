"""
Authentication API endpoints
"""
from fastapi import APIRouter, HTTPException, status, Request, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Dict, Any
from app.services.auth_service import auth_service
from app.services.google_oauth import google_oauth_service
from app.middleware.auth import jwt_bearer, get_current_user
from app.core.database import supabase
from datetime import datetime

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
            expires_in=3600,
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

        user = await auth_service.get_user(result["access_token"])

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired refresh token"
            )

        return AuthResponse(
            access_token=result["access_token"],
            refresh_token=result["refresh_token"],
            token_type="Bearer",
            expires_in=3600,
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


# ===== DIRECT GOOGLE OAUTH (with custom scopes) =====

@router.post("/google/connect", dependencies=[Depends(jwt_bearer)])
async def connect_google_services(current_user: Dict = Depends(get_current_user)):
    """
    Generate Google OAuth URL for connecting Calendar/Gmail
    User must be already logged in
    """
    try:
        # Pass user ID in state to reconnect after OAuth
        state = current_user["id"]
        url = google_oauth_service.get_authorization_url(state=state)
        print(f"🔗 [Google OAuth] Generated URL for user {current_user['email']}")
        return {"url": url}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate OAuth URL: {str(e)}"
        )


@router.get("/google/callback")
async def google_oauth_callback(code: str, state: str = None):
    """
    Handle Google OAuth callback - stores Calendar/Gmail tokens
    State contains user_id from the logged-in session
    """
    try:
        print(f"📥 [Google OAuth] Received callback, user_id from state: {state}")

        # Exchange code for Google tokens
        print(f"🔄 [Google OAuth] Exchanging code for tokens...")
        token_response = await google_oauth_service.exchange_code_for_tokens(code)

        google_access_token = token_response["access_token"]
        google_refresh_token = token_response.get("refresh_token")
        expires_in = token_response.get("expires_in", 3600)

        print(f"✅ [Google OAuth] Got tokens (expires in {expires_in}s)")

        # Calculate expiry time
        expires_at_timestamp = datetime.utcnow().timestamp() + expires_in
        expires_at = datetime.fromtimestamp(expires_at_timestamp).isoformat()

        # Store Google OAuth tokens for the user
        token_data = {
            "user_id": state,  # User ID from state parameter
            "provider": "google",
            "access_token": google_access_token,
            "refresh_token": google_refresh_token,
            "expires_at": expires_at,
            "scopes": google_oauth_service.SCOPES,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }

        supabase.table("user_oauth_tokens").upsert(
            token_data,
            on_conflict="user_id,provider"
        ).execute()

        print(f"✅ [Google OAuth] Stored tokens with scopes: {google_oauth_service.SCOPES}")

        # Return HTML that closes window and notifies parent
        return JSONResponse({
            "success": True,
            "message": "Google Calendar and Gmail connected successfully!",
            "close_window": True
        })

    except Exception as e:
        print(f"❌ [Google OAuth] Callback error: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse({
            "success": False,
            "error": str(e),
            "message": "Failed to connect Google services"
        }, status_code=400)


@router.get("/google/status", dependencies=[Depends(jwt_bearer)])
async def check_google_connection(current_user: Dict = Depends(get_current_user)):
    """
    Check if user has connected Google Calendar & Gmail
    Returns connection status and scopes
    """
    try:
        user_id = current_user["id"]

        # Check if user has Google OAuth tokens
        result = supabase.table("user_oauth_tokens")\
            .select("scopes, expires_at, created_at")\
            .eq("user_id", user_id)\
            .eq("provider", "google")\
            .order("created_at", desc=True)\
            .limit(1)\
            .execute()

        if result.data and len(result.data) > 0:
            token_data = result.data[0]
            return {
                "connected": True,
                "scopes": token_data.get("scopes", []),
                "expires_at": token_data.get("expires_at"),
                "has_calendar": any("calendar" in s for s in token_data.get("scopes", [])),
                "has_gmail": any("gmail" in s for s in token_data.get("scopes", []))
            }
        else:
            return {
                "connected": False,
                "scopes": [],
                "has_calendar": False,
                "has_gmail": False
            }

    except Exception as e:
        print(f"❌ [Google OAuth] Status check error: {str(e)}")
        return {
            "connected": False,
            "error": str(e)
        }
