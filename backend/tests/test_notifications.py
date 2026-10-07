import os
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-secret-key")

from app.main import CurrentUser, app, current_user, gateway

USER_ID = UUID("00000000-0000-0000-0000-000000000001")
NOTIFICATION_ID = UUID("00000000-0000-0000-0000-000000000002")


@pytest.fixture
def notification_client():
    app.dependency_overrides[current_user] = lambda: CurrentUser(
        id=USER_ID, token="user-token"
    )
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def test_list_notifications_returns_unread_count(notification_client, monkeypatch):
    rows = AsyncMock(
        return_value=[
            {"id": str(NOTIFICATION_ID), "read_at": None},
            {
                "id": "00000000-0000-0000-0000-000000000003",
                "read_at": "2026-09-11T10:00:00Z",
            },
        ]
    )
    monkeypatch.setattr(gateway, "rows", rows)

    response = notification_client.get("/api/notifications")

    assert response.status_code == 200
    assert response.json()["unreadCount"] == 1
    assert len(response.json()["items"]) == 2
    assert rows.call_args.kwargs["filters"] == {"recipient_id": f"eq.{USER_ID}"}


def test_user_can_mark_only_own_notification_read(notification_client, monkeypatch):
    request = AsyncMock(return_value=[{"id": str(NOTIFICATION_ID)}])
    monkeypatch.setattr(gateway, "request", request)

    response = notification_client.post(f"/api/notifications/{NOTIFICATION_ID}/read")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    params = request.call_args.kwargs["params"]
    assert params["id"] == f"eq.{NOTIFICATION_ID}"
    assert params["recipient_id"] == f"eq.{USER_ID}"
    assert request.call_args.kwargs["token"] == "user-token"


def test_unknown_notification_is_not_reported_as_read(notification_client, monkeypatch):
    monkeypatch.setattr(gateway, "request", AsyncMock(return_value=[]))

    response = notification_client.post(f"/api/notifications/{NOTIFICATION_ID}/read")

    assert response.status_code == 404
