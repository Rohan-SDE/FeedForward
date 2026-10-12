import os
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_PUBLISHABLE_KEY"] = "test-key"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-secret"

from fastapi.testclient import TestClient
from app.main import app, current_user, gateway, CurrentUser


@pytest.mark.parametrize("role,identities,expected", [
    ("volunteer", [{"provider": "email"}], 403),
    ("volunteer", [], 403),
    ("volunteer", [{"provider": "google"}], 200),
    ("ngo", [{"provider": "email"}], 200),
    ("donor", [{"provider": "email"}], 200),
])
def test_registration_provider(monkeypatch, role, identities, expected):
    monkeypatch.setattr(gateway, "rows", AsyncMock(return_value=[]))
    monkeypatch.setattr(gateway, "user", AsyncMock(return_value={
        "identities": identities,
        "user_metadata": {"provider": "google"},
    }))
    write = AsyncMock()
    monkeypatch.setattr(gateway, "request", write)
    app.dependency_overrides[current_user] = lambda: CurrentUser(
        id=UUID("00000000-0000-0000-0000-000000000001"), token="test-token"
    )
    try:
        with TestClient(app) as client:
            response = client.post("/api/roles", json={"role": role})
        assert response.status_code == expected
        assert write.await_count == (1 if expected == 200 else 0)
    finally:
        app.dependency_overrides.clear()
