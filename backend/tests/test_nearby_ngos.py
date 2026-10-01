import os
from unittest.mock import AsyncMock

os.environ.setdefault('SUPABASE_URL', 'https://example.supabase.co')
os.environ.setdefault('SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'test-secret-key')

from fastapi.testclient import TestClient
from app.main import app, gateway, current_user, CurrentUser
from uuid import UUID


def test_nearby_ngos_filters_sorts_and_limits_disclosure(monkeypatch):
    async def rows(table, **kwargs):
        if table == 'user_roles':
            return [{'user_id': 'a'}, {'user_id': 'b'}] if kwargs.get('admin') else [{'role': 'donor'}]
        if not kwargs.get('admin'):
            return [{'latitude': 0, 'longitude': 0, 'service_radius_km': 10}]
        return [
            {'id': 'b', 'org_name': 'Further', 'latitude': 0, 'longitude': .05, 'phone': 'private'},
            {'id': 'a', 'org_name': 'Closer', 'latitude': 0, 'longitude': .01, 'verified': True},
            {'id': 'c', 'latitude': 0, 'longitude': 1},
            {'id': 'd', 'latitude': None, 'longitude': None},
        ]
    monkeypatch.setattr(gateway, 'rows', rows)
    app.dependency_overrides[current_user] = lambda: CurrentUser(id=UUID(int=1), token='test')
    try:
        response = TestClient(app).get('/api/ngos/nearby')
        assert response.status_code == 200
        items = response.json()['ngos']
        assert [row['id'] for row in items] == ['a', 'b']
        assert set(items[0]) == {'id', 'name', 'city', 'verified', 'distanceKm'}
    finally:
        app.dependency_overrides.clear()


def test_nearby_ngos_missing_location_and_wrong_role(monkeypatch):
    app.dependency_overrides[current_user] = lambda: CurrentUser(id=UUID(int=1), token='test')
    try:
        mock = AsyncMock(side_effect=[[{'role': 'donor'}], [{'latitude': None, 'longitude': None}]])
        monkeypatch.setattr(gateway, 'rows', mock)
        assert TestClient(app).get('/api/ngos/nearby').json()['requiresLocation'] is True
        assert mock.await_count == 2
        monkeypatch.setattr(gateway, 'rows', AsyncMock(return_value=[{'role': 'volunteer'}]))
        assert TestClient(app).get('/api/ngos/nearby').status_code == 403
    finally:
        app.dependency_overrides.clear()
