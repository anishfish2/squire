"""
Authentication service using Supabase Auth
"""
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from supabase import Client
from app.core.database import supabase
from app.core.config import settings
import httpx
import json


class AuthService:
    """Service for handling authentication with Supabase"""

    def __init__(self):
        self.supabase: Client = supabase
        self.pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    async def sign_up(self, email: str, password: str, user_metadata: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Sign up a new user with email and password

        Args:
            email: User's email address
            password: User's password
            user_metadata: Additional user metadata (name, etc.)

        Returns:
            Dict containing user info and tokens
        """
        try:
            # Sign up with Supabase Auth
            response = self.supabase.auth.sign_up({
                "email": email,
                "password": password,
                "options": {
                    "data": user_metadata or {}
                }
            })

            if response.user:
                # User profile is automatically created by database trigger
                # No need to manually insert

                return {
                    "user": response.user,
                    "session": response.session,
                    "access_token": response.session.access_token if response.session else None,
                    "refresh_token": response.session.refresh_token if response.session else None
                }

            raise Exception("Sign up failed - no user returned")

        except Exception as e:
            raise Exception(f"Sign up error: {str(e)}")

    async def sign_in(self, email: str, password: str) -> Dict[str, Any]:
        """
        Sign in an existing user with email and password

        Args:
            email: User's email address
            password: User's password

        Returns:
            Dict containing user info and tokens
        """
        try:
            response = self.supabase.auth.sign_in_with_password({
                "email": email,
                "password": password
            })

            if response.user and response.session:
                # Update last_active time
                self.supabase.table("user_profiles").update({
                    "last_active": datetime.utcnow().isoformat()
                }).eq("id", response.user.id).execute()

                return {
                    "user": response.user,
                    "session": response.session,
                    "access_token": response.session.access_token,
                    "refresh_token": response.session.refresh_token
                }

            raise Exception("Invalid credentials")

        except Exception as e:
            raise Exception(f"Sign in error: {str(e)}")

    async def sign_out(self, access_token: str) -> bool:
        """
        Sign out the current user

        Args:
            access_token: User's access token

        Returns:
            True if successful
        """
        try:
            self.supabase.auth.sign_out()
            return True
        except Exception as e:
            raise Exception(f"Sign out error: {str(e)}")

    async def refresh_token(self, refresh_token: str) -> Dict[str, Any]:
        """
        Refresh the access token using refresh token

        Args:
            refresh_token: User's refresh token

        Returns:
            Dict containing new tokens
        """
        try:
            response = self.supabase.auth.refresh_session(refresh_token)

            if response.session:
                return {
                    "access_token": response.session.access_token,
                    "refresh_token": response.session.refresh_token,
                    "expires_at": response.session.expires_at
                }

            raise Exception("Token refresh failed")

        except Exception as e:
            raise Exception(f"Token refresh error: {str(e)}")

    async def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """
        Verify and decode a JWT token

        Args:
            token: JWT token to verify

        Returns:
            Decoded token payload if valid, None otherwise
        """
        try:
            print(f"🔐 VERIFY TOKEN: Starting verification for token: {token[:30]}...")
            print(f"🔐 VERIFY TOKEN: JWT Secret set? {bool(settings.SUPABASE_JWT_SECRET)}")

            # If JWT secret is not set, use Supabase's get_user method
            if not settings.SUPABASE_JWT_SECRET:
                print("🔐 VERIFY TOKEN: No JWT secret, using Supabase get_user")
                response = self.supabase.auth.get_user(token)
                if response and response.user:
                    print("✅ VERIFY TOKEN: User verified via Supabase")
                    return {
                        "sub": response.user.id,
                        "email": response.user.email,
                        "user_metadata": response.user.user_metadata,
                        "aud": response.user.aud,
                        "role": response.user.role
                    }
                print("❌ VERIFY TOKEN: Supabase verification failed")
                return None

            # Verify with JWT secret
            print(f"🔐 VERIFY TOKEN: Using JWT secret to decode")
            payload = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=[settings.JWT_ALGORITHM],
                options={"verify_aud": False}  # Supabase uses specific audience
            )
            print(f"✅ VERIFY TOKEN: Successfully decoded. Payload: {payload}")
            return payload

        except JWTError as e:
            print(f"❌ VERIFY TOKEN: JWTError: {str(e)}")
            return None
        except Exception as e:
            print(f"❌ VERIFY TOKEN: Exception: {str(e)}")
            import traceback
            print(f"❌ VERIFY TOKEN TRACEBACK: {traceback.format_exc()}")
            return None

    async def get_user(self, token: str) -> Optional[Dict[str, Any]]:
        """
        Get user details from token

        Args:
            token: User's access token

        Returns:
            User details if valid
        """
        try:
            print(f"🔍 AUTH SERVICE: Getting user with token: {token[:30]}...")
            response = self.supabase.auth.get_user(token)
            print(f"🔍 AUTH SERVICE: Response object: {response}")

            if response and response.user:
                print(f"✅ AUTH SERVICE: User found: {response.user.id}")

                # For now, skip profile query and just return user info
                # The profile query was failing due to RLS
                result = {
                    "id": response.user.id,
                    "email": response.user.email,
                    "profile": None,  # Skip profile for now
                    "metadata": response.user.user_metadata
                }
                print(f"✅ AUTH SERVICE: Returning user data: {result}")
                return result

            print("❌ AUTH SERVICE: No user found in response")
            return None

        except Exception as e:
            print(f"❌ AUTH SERVICE ERROR: {str(e)}")
            import traceback
            print(f"❌ AUTH SERVICE TRACEBACK: {traceback.format_exc()}")
            return None

    async def sign_in_with_oauth(self, provider: str, redirect_to: str = None) -> Dict[str, Any]:
        """
        Generate OAuth sign-in URL for third-party providers

        Args:
            provider: OAuth provider (google, github, etc.)
            redirect_to: URL to redirect after auth

        Returns:
            Dict containing OAuth URL
        """
        try:
            options = {}
            if redirect_to:
                options["redirect_to"] = redirect_to

            response = self.supabase.auth.sign_in_with_oauth({
                "provider": provider,
                "options": options
            })

            return {
                "url": response.url,
                "provider": provider
            }

        except Exception as e:
            raise Exception(f"OAuth sign-in error: {str(e)}")

    async def handle_oauth_callback(self, code: str, provider: str) -> Dict[str, Any]:
        """
        Handle OAuth callback and exchange code for tokens

        Args:
            code: OAuth authorization code
            provider: OAuth provider name

        Returns:
            Dict containing user info and tokens
        """
        try:
            # Exchange code for session
            response = self.supabase.auth.exchange_code_for_session({
                "auth_code": code
            })

            if response.user and response.session:
                # User profile is automatically created by database trigger
                # No need to manually insert

                # Store OAuth tokens if needed for API access
                if provider in ["google", "github"]:
                    await self._store_oauth_tokens(
                        response.user.id,
                        provider,
                        response.session.provider_token,
                        response.session.provider_refresh_token
                    )

                return {
                    "user": response.user,
                    "session": response.session,
                    "access_token": response.session.access_token,
                    "refresh_token": response.session.refresh_token
                }

            raise Exception("OAuth callback failed")

        except Exception as e:
            raise Exception(f"OAuth callback error: {str(e)}")

    async def _store_oauth_tokens(self, user_id: str, provider: str,
                                  access_token: str, refresh_token: str = None) -> None:
        """
        Store OAuth tokens for external service access

        Args:
            user_id: User's ID
            provider: OAuth provider name
            access_token: OAuth access token
            refresh_token: Optional OAuth refresh token
        """
        try:
            token_data = {
                "user_id": user_id,
                "provider": provider,
                "access_token": access_token,  # Should be encrypted in production
                "refresh_token": refresh_token,  # Should be encrypted in production
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }

            # Upsert token data
            self.supabase.table("user_oauth_tokens").upsert(
                token_data,
                on_conflict="user_id,provider"
            ).execute()

        except Exception as e:
            # Log error but don't fail the auth flow
            print(f"Failed to store OAuth tokens: {str(e)}")


# Singleton instance
auth_service = AuthService()