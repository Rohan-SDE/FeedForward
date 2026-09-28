from io import BytesIO
from unittest.mock import AsyncMock
from uuid import UUID
import pytest
from PIL import Image
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.photos import normalize_photo, MAX_UPLOAD_BYTES
from app.main import app, current_user, CurrentUser, gateway


def photo():
    output = BytesIO()
    Image.new('RGB', (2000, 1000), 'green').save(output, 'PNG')
    return output.getvalue()


def test_photo_reencoded_and_resized():
    result = Image.open(BytesIO(normalize_photo(photo())))
    assert result.format == 'JPEG'
    assert result.size == (1600, 800)
    assert not result.getexif()


@pytest.mark.parametrize('raw', [b'<svg onload="alert(1)"></svg>', b'not a picture', b''])
def test_invalid_photo_rejected(raw):
    with pytest.raises(HTTPException):
        normalize_photo(raw)


def test_oversized_photo_rejected():
    with pytest.raises(HTTPException) as error:
        normalize_photo(b'x' * (MAX_UPLOAD_BYTES + 1))
    assert error.value.status_code == 413


@pytest.fixture
def photo_client(monkeypatch):
    monkeypatch.setattr(gateway, 'rows', AsyncMock(return_value=[{'role':'donor'}]))
    monkeypatch.setattr(gateway, 'request', AsyncMock(return_value=True))
    monkeypatch.setattr(gateway, 'upload_photo', AsyncMock(return_value='https://example.supabase.co/storage/v1/object/public/food-photos/test.jpg'))
    app.dependency_overrides[current_user] = lambda: CurrentUser(id=UUID(int=1), token='test')
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def test_upload_registers_server_generated_photo(photo_client):
    response = photo_client.post('/api/photos', content=photo(), headers={'content-type':'application/octet-stream'})
    assert response.status_code == 201
    gateway.upload_photo.assert_awaited_once()
    assert gateway.request.await_count == 2
    registered = gateway.request.call_args.kwargs['json']
    assert registered['owner_id'] == str(UUID(int=1))
    assert registered['object_path'].startswith(str(UUID(int=1)) + '/')


def test_upload_quota_prevents_storage_write(photo_client):
    gateway.request.return_value = False
    response = photo_client.post('/api/photos', content=photo())
    assert response.status_code == 429
    gateway.upload_photo.assert_not_called()


def test_upload_role_checked(photo_client):
    gateway.rows.return_value = [{'role':'volunteer'}]
    assert photo_client.post('/api/photos', content=photo()).status_code == 403
    gateway.upload_photo.assert_not_called()


def test_body_limit_enforced_before_validation(photo_client):
    assert photo_client.post('/api/photos', content=b'x'*(MAX_UPLOAD_BYTES+1)).status_code == 413
    assert photo_client.post('/api/listings', content=b'x'*(1024*1024+1)).status_code == 413
    gateway.upload_photo.assert_not_called()
