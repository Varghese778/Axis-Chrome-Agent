"""
backend/config.py
Application settings loaded from environment variables.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # GCP (Firestore, Cloud Run)
    google_cloud_project: str = "sightbridge-hackathon-2"
    google_cloud_location: str = "us-central1"

    # Firestore
    firestore_collection: str = "sessions"

    # Firebase Auth
    firebase_project_id: str = "sightbridge-hackathon-2"

    # Server
    host: str = "0.0.0.0"
    port: int = 8080
    backend_url: str = "https://axis-backend-461115625041.us-central1.run.app"
    environment: str = "production"

    # Extension
    extension_origin: str = "chrome-extension://*"

    # Feedback SMTP
    feedback_sender_email: str = ""
    feedback_sender_app_password: str = ""
    feedback_recipient_email: str = ""
    # Personalize Axis
    # ... existing fields ...

    # Usage Limits
    limit_inputs: int = 15
    limit_images: int = 5


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
