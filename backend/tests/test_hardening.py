import asyncio
import os
from unittest.mock import AsyncMock
from uuid import UUID

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "test-public")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-secret")

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.main import app, current_user, CurrentUser, gateway, Point, ScheduleInput
from app.supabase import SupabaseGateway
from app.config import Settings

USER = UUID("00000000-0000-0000-0000-000000000001")

@pytest.mark.parametrize("lat,lng", [(91, 0), (0, 181), (float("nan"), 0)])
def test_invalid_route_coordinates(lat, lng):
    with pytest.raises(ValidationError):
        Point(lat=lat, lng=lng)


def test_naive_pickup_time_rejected():
    with pytest.raises(ValidationError):
        ScheduleInput(claim_id=USER, scheduled_time="2030-01-01T12:00:00")


def test_claim_cancellation_uses_atomic_rpc(monkeypatch):
    rows = AsyncMock(return_value=[{"role": "ngo"}])
    rpc = AsyncMock(return_value=True)
    monkeypatch.setattr(gateway, "rows", rows)
    monkeypatch.setattr(gateway, "rpc", rpc)
    app.dependency_overrides[current_user] = lambda: CurrentUser(id=USER, token="test")
    try:
        response = TestClient(app).post("/api/claims/cancel", json={"id": str(USER)})
        assert response.status_code == 200
        rpc.assert_awaited_once_with("cancel_food_claim", {"_claim_id": str(USER)}, token="test")
        assert response.headers["cache-control"] == "no-store"
        UUID(response.headers["x-request-id"])
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("status,payload,expected,message", [
    (500, {"message": "sensitive database details"}, 503, "Database service is unavailable"),
    (409, {"code": "23505", "message": "sensitive index name"}, 409, "This record already exists"),
    (400, {"code": "P0001", "message": "Claim not found"}, 400, "Claim not found"),
    (403, {"message": "internal policy"}, 403, "This operation is not permitted"),
])
def test_gateway_error_mapping(status, payload, expected, message):
    async def check():
        g = SupabaseGateway(Settings(supabase_url="https://example.supabase.co", supabase_publishable_key="public", supabase_service_role_key="secret"))
        g._client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(status, json=payload)))
        try:
            with pytest.raises(HTTPException) as error:
                await g.request("POST", "claims", json={})
            assert error.value.status_code == expected
            assert error.value.detail == message
        finally:
            await g.close()
    asyncio.run(check())


def test_auth_outage_is_not_reported_as_expired_session():
    async def check():
        g = SupabaseGateway(Settings(supabase_url="https://example.supabase.co", supabase_publishable_key="public", supabase_service_role_key="secret"))
        g._client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(503)))
        try:
            with pytest.raises(HTTPException) as error:
                await g.user("test")
            assert error.value.status_code == 503
        finally:
            await g.close()
    asyncio.run(check())


def test_legacy_service_jwt_has_bearer_header():
    g = SupabaseGateway(Settings(supabase_url="https://example.supabase.co", supabase_publishable_key="public", supabase_service_role_key="eyJ.test.service"))
    assert g._headers(admin=True)["Authorization"] == "Bearer eyJ.test.service"


def test_new_secret_key_is_not_used_as_bearer_token():
    g = SupabaseGateway(Settings(supabase_url="https://example.supabase.co", supabase_publishable_key="public", supabase_service_role_key="sb_secret_test"))
    assert "Authorization" not in g._headers(admin=True)
    assert g._headers(token="user-token")["Authorization"] == "Bearer user-token"
