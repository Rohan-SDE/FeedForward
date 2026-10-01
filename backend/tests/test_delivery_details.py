import os
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-secret-key")

from app.main import CurrentUser, app, current_user, gateway

VOLUNTEER_ID = UUID("00000000-0000-0000-0000-000000000001")
NGO_ID = UUID("00000000-0000-0000-0000-000000000002")
PICKUP_ID = UUID("00000000-0000-0000-0000-000000000003")


def assigned_pickup():
    return {
        "id": str(PICKUP_ID),
        "volunteer_id": str(VOLUNTEER_ID),
        "status": "scheduled",
        "claims": {
            "ngo_id": str(NGO_ID),
            "claimed_quantity": 10,
            "food_listings": {
                "title": "Fresh meals",
                "latitude": 22.7,
                "longitude": 88.5,
            },
        },
    }


@pytest.fixture
def volunteer_client():
    app.dependency_overrides[current_user] = lambda: CurrentUser(
        id=VOLUNTEER_ID, token="volunteer-token"
    )
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def test_assigned_volunteer_can_read_ngo_and_partner_details(volunteer_client, monkeypatch):
    ngo = {"id": str(NGO_ID), "org_name": "Receiver NGO", "phone": "111"}
    volunteer = {
        "id": str(VOLUNTEER_ID),
        "full_name": "Delivery Partner",
        "phone": "222",
    }

    async def rows(table, **kwargs):
        if table == "user_roles":
            return [{"role": "volunteer"}]
        if table == "pickups":
            return [assigned_pickup()]
        if table == "profiles":
            assert kwargs["token"] == "volunteer-token"
            return [ngo, volunteer]
        raise AssertionError(f"Unexpected table: {table}")

    monkeypatch.setattr(gateway, "rows", rows)
    response = volunteer_client.get(f"/api/pickups/{PICKUP_ID}/delivery-details")

    assert response.status_code == 200
    assert response.json()["ngo"]["org_name"] == "Receiver NGO"
    assert response.json()["volunteer"]["full_name"] == "Delivery Partner"


def test_unassigned_rider_cannot_read_details(volunteer_client, monkeypatch):
    pickup = assigned_pickup()
    pickup["volunteer_id"] = None

    async def rows(table, **kwargs):
        if table == "user_roles":
            return [{"role": "volunteer"}]
        if table == "pickups":
            return [pickup]
        raise AssertionError("Profiles must not be queried before assignment")

    monkeypatch.setattr(gateway, "rows", rows)
    response = volunteer_client.get(f"/api/pickups/{PICKUP_ID}/delivery-details")

    assert response.status_code == 403


def test_unassigned_user_cannot_read_delivery_parties(monkeypatch):
    outsider_id = UUID("00000000-0000-0000-0000-000000000004")
    app.dependency_overrides[current_user] = lambda: CurrentUser(
        id=outsider_id, token="outsider-token"
    )

    async def rows(table, **kwargs):
        if table == "user_roles":
            return [{"role": "volunteer"}]
        if table == "pickups":
            return [assigned_pickup()]
        raise AssertionError("Profiles must not be queried for an outsider")

    monkeypatch.setattr(gateway, "rows", rows)
    try:
        with TestClient(app) as client:
            response = client.get(f"/api/pickups/{PICKUP_ID}/delivery-details")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403


def test_accept_returns_redirect_pickup_id(volunteer_client, monkeypatch):
    monkeypatch.setattr(gateway, "rows", AsyncMock(return_value=[{"role": "volunteer"}]))
    monkeypatch.setattr(gateway, "rpc", AsyncMock(return_value=True))

    response = volunteer_client.post(
        "/api/delivery-requests/accept", json={"pickup_id": str(PICKUP_ID)}
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "pickupId": str(PICKUP_ID)}


def test_volunteer_advances_delivery_in_order(volunteer_client, monkeypatch):
    monkeypatch.setattr(gateway, "rows", AsyncMock(return_value=[{"role": "volunteer"}]))
    rpc = AsyncMock(return_value=True)
    monkeypatch.setattr(gateway, "rpc", rpc)

    response = volunteer_client.post(
        "/api/pickups/advance",
        json={"id": str(PICKUP_ID), "status": "en_route"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    rpc.assert_awaited_once_with(
        "advance_delivery_pickup",
        {"_pickup_id": str(PICKUP_ID), "_next_status": "en_route"},
        token="volunteer-token",
    )


def test_failed_atomic_transition_is_not_reported_as_success(volunteer_client, monkeypatch):
    monkeypatch.setattr(gateway, "rows", AsyncMock(return_value=[{"role": "volunteer"}]))
    monkeypatch.setattr(gateway, "rpc", AsyncMock(return_value=False))

    response = volunteer_client.post(
        "/api/pickups/advance",
        json={"id": str(PICKUP_ID), "status": "en_route"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Delivery status could not be updated"


def test_claiming_ngo_can_track_before_assignment(volunteer_client, monkeypatch):
    app.dependency_overrides[current_user] = lambda: CurrentUser(id=NGO_ID, token="ngo-token")
    pickup = assigned_pickup()
    pickup["volunteer_id"] = None
    async def rows(table, **kwargs):
        if table == "user_roles": return [{"role": "ngo"}]
        if table == "pickups": return [pickup]
        if table == "profiles": return [{"id": str(NGO_ID)}]
        raise AssertionError(table)
    monkeypatch.setattr(gateway, "rows", rows)
    response = volunteer_client.get(f"/api/pickups/{PICKUP_ID}/delivery-details")
    assert response.status_code == 200
    assert response.json()["volunteer"] is None
    assert response.json()["pickup"]["claims"]["food_listings"]["latitude"] == 22.7
