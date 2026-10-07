import os
from unittest.mock import AsyncMock

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-secret-key")

from fastapi.testclient import TestClient

from app.main import app, gateway


def test_health() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness_checks_database(monkeypatch) -> None:
    rows = AsyncMock(return_value=[])
    monkeypatch.setattr(gateway, "rows", rows)
    response = TestClient(app).get("/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    rows.assert_awaited_once()
