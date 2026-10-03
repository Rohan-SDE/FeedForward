from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "FeedForward API"
    environment: str = "development"
    supabase_url: str
    supabase_publishable_key: str
    supabase_service_role_key: str
    frontend_origins: str = Field(
        default="http://localhost:8001,http://127.0.0.1:8001"
    )

    @model_validator(mode="after")
    def validate_production_configuration(self) -> "Settings":
        if self.supabase_publishable_key == self.supabase_service_role_key:
            raise ValueError("Publishable and service-role keys must be different")
        if self.environment.lower() == "production":
            if not self.cors_origins or "*" in self.cors_origins:
                raise ValueError("Production FRONTEND_ORIGINS must contain explicit HTTPS origins")
            insecure = [origin for origin in self.cors_origins if not origin.startswith("https://")]
            if insecure:
                raise ValueError("Production FRONTEND_ORIGINS must use HTTPS")
            for origin in self.cors_origins:
                parsed = urlsplit(origin)
                if not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or "*" in origin:
                    raise ValueError("FRONTEND_ORIGINS must be exact origins without paths or credentials")
            upstream = urlsplit(self.supabase_url)
            if upstream.scheme != "https" or not upstream.hostname or upstream.username or upstream.password:
                raise ValueError("Production SUPABASE_URL must use HTTPS without credentials")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.frontend_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
