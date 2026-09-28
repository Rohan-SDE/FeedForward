import pytest
from pydantic import ValidationError

from app.config import Settings


def settings(**overrides):
    values = {
        "supabase_url": "https://example.supabase.co",
        "supabase_publishable_key": "publishable-key",
        "supabase_service_role_key": "service-role-key",
        "frontend_origins": "https://feedforward.example.com",
        "environment": "production",
    }
    values.update(overrides)
    return Settings(**values)


def test_production_configuration_accepts_explicit_https_origin():
    configured = settings()
    assert configured.cors_origins == ["https://feedforward.example.com"]


def test_production_configuration_rejects_wildcard_origin():
    with pytest.raises(ValidationError, match="explicit HTTPS origins"):
        settings(frontend_origins="*")


def test_production_configuration_rejects_http_origin():
    with pytest.raises(ValidationError, match="must use HTTPS"):
        settings(frontend_origins="http://feedforward.example.com")


def test_configuration_rejects_reused_service_role_key():
    with pytest.raises(ValidationError, match="must be different"):
        settings(supabase_service_role_key="publishable-key")


@pytest.mark.parametrize("origin", ["https://", "https://user:pass@example.com", "https://example.com/path", "https://*.example.com"])
def test_invalid_origin_shapes(origin):
    with pytest.raises(ValidationError):
        settings(frontend_origins=origin)


def test_production_requires_secure_upstream():
    with pytest.raises(ValidationError):
        settings(supabase_url="http://example.com")
