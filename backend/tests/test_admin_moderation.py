import os
os.environ.setdefault('SUPABASE_URL','https://example.supabase.co')
os.environ.setdefault('SUPABASE_PUBLISHABLE_KEY','test-publishable-key')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY','test-secret-key')
from unittest.mock import AsyncMock
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from app.main import app, gateway, current_user, CurrentUser

UID = UUID('00000000-0000-0000-0000-000000000006')
TARGET = '00000000-0000-0000-0000-000000000001'

@pytest.mark.parametrize('path,allowed', [('/api/me',True),('/api/account-status',True),('/api/support',True),('/api/admin/overview',False),('/api/listings',False),('/api/notifications',False)])
def test_blocked_session_is_checked_on_every_request(monkeypatch,path,allowed):
    monkeypatch.setattr(gateway,'user',AsyncMock(return_value={'id':str(UID)}))
    monkeypatch.setattr(gateway,'rpc',AsyncMock(return_value=True))
    monkeypatch.setattr(gateway,'rows',AsyncMock(return_value=[]))
    monkeypatch.setattr(gateway,'request',AsyncMock(return_value=[]))
    with TestClient(app) as client:
        response = client.get(path,headers={'Authorization':'Bearer existing-session'})
    assert response.status_code == (200 if allowed else 403)
    gateway.rpc.assert_any_call('account_is_blocked',{'_user':str(UID)},token='existing-session')

@pytest.mark.parametrize('role,expected', [('ngo',403),('donor',403),('volunteer',403),('admin',200)])
def test_moderation_is_admin_only(monkeypatch,role,expected):
    app.dependency_overrides[current_user]=lambda:CurrentUser(id=UID,token='test')
    monkeypatch.setattr(gateway,'rows',AsyncMock(return_value=[{'role':role}]))
    rpc=AsyncMock(return_value=True)
    monkeypatch.setattr(gateway,'rpc',rpc)
    try:
        with TestClient(app) as client:
            response=client.post(f'/api/admin/users/{TARGET}/moderation',json={'action':'block','reason':'Complaint verified'})
        assert response.status_code==expected
        if expected==403: rpc.assert_not_called()
        else:
            assert rpc.call_args.args[1]['_user_id']==TARGET
            assert rpc.call_args.kwargs['token']=='test'
    finally:
        app.dependency_overrides.clear()


def test_user_detail_denied_to_non_admin(monkeypatch):
    app.dependency_overrides[current_user]=lambda:CurrentUser(id=UID,token='test')
    rows=AsyncMock(return_value=[{'role':'ngo'}])
    monkeypatch.setattr(gateway,'rows',rows)
    try:
        with TestClient(app) as client:
            assert client.get(f'/api/admin/users/{TARGET}').status_code==403
        assert rows.call_count==1
    finally: app.dependency_overrides.clear()


def test_support_archive_reads_all_pages_with_user_rls(monkeypatch):
    app.dependency_overrides[current_user]=lambda:CurrentUser(id=UID,token='test')
    request=AsyncMock(side_effect=[[{'id':str(i)} for i in range(200)],[{'id':'last'}]])
    monkeypatch.setattr(gateway,'request',request)
    try:
        with TestClient(app) as client:
            response=client.get('/api/support')
        assert response.status_code==200 and len(response.json())==201
        assert request.call_args.kwargs['params']['offset']=='200'
        assert request.call_args.kwargs['token']=='test'
    finally: app.dependency_overrides.clear()
