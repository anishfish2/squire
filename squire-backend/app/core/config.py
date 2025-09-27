"""
Configuration settings for the application
"""
from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    # Server settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = True

    # Supabase settings
    SUPABASE_URL: str
    SUPABASE_KEY: str

    # OpenAI settings
    OPENAI_API_KEY: str

    # Security settings
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:8000"]
    ALLOWED_HOSTS: List[str] = ["localhost", "127.0.0.1"]

    # Rate limiting
    RATE_LIMIT_REQUESTS: int = 1000
    RATE_LIMIT_WINDOW: int = 900  # 15 minutes

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()