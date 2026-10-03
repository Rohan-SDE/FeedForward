import os
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

# No real service or credentials are used by these tests.
os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_PUBLISHABLE_KEY"] = "test-publishable-key"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-secret-key"

from fastapi.testclient import TestClient
from app.main import app, current_user, gateway, CurrentUser

USER_ID = UUID("00000000-0000-0000-0000-000000000001")


@pytest.fixture
def profile_client(monkeypatch):
    request = AsyncMock(return_value=[{"id": str(USER_ID)}])
    monkeypatch.setattr(gateway, "request", request)
    app.dependency_overrides[current_user] = lambda: CurrentUser(
        id=USER_ID, token="test-user-token"
    )
    try:
        with TestClient(app) as client:
            yield client, request
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("extra", [{}, {"food_preferences": None}])
def test_save_preserves_preferences_and_clears_nullable_fields(profile_client, extra):
    client, request = profile_client
    response = client.patch("/api/profile", json={
        "full_name": "Test Volunteer",
        "latitude": 22.746805,
        "longitude": 88.518611,
        "address": None,
        **extra,
    })
    assert response.status_code == 200
    payload = request.call_args.kwargs["json"]
    assert "food_preferences" not in payload
    assert "service_radius_km" not in payload
    assert payload["address"] is None
    assert payload["latitude"] == 22.746805
    assert request.call_args.kwargs["params"]["id"] == f"eq.{USER_ID}"
    assert request.call_args.kwargs["token"] == "test-user-token"


@pytest.mark.parametrize("preferences", [[], ["veg"]])
def test_explicit_preferences_can_be_updated(profile_client, preferences):
    client, request = profile_client
    response = client.patch("/api/profile", json={
        "full_name": "Test NGO", "food_preferences": preferences,
    })
    assert response.status_code == 200
    assert request.call_args.kwargs["json"]["food_preferences"] == preferences


def test_no_updated_row_is_not_reported_as_success(profile_client):
    client, request = profile_client
    request.return_value = []
    response = client.patch("/api/profile", json={"full_name": "Test"})
    assert response.status_code == 404


def test_invalid_coordinates_do_not_reach_database(profile_client):
    client, request = profile_client
    response = client.patch("/api/profile", json={"full_name": "Test", "latitude": 100})
    assert response.status_code == 422
    request.assert_not_called()


def test_profile_requires_authentication(monkeypatch):
    request = AsyncMock()
    monkeypatch.setattr(gateway, "request", request)
    with TestClient(app) as client:
        response = client.patch("/api/profile", json={"full_name": "Test"})
    assert response.status_code == 401
    request.assert_not_called()
