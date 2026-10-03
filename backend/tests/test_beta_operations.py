import os
from uuid import UUID
from unittest.mock import AsyncMock
import pytest
os.environ.setdefault('SUPABASE_URL','https://example.supabase.co')
os.environ.setdefault('SUPABASE_PUBLISHABLE_KEY','test-publishable-key')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY','test-secret-key')
from fastapi.testclient import TestClient
from app.main import app, gateway, current_user, CurrentUser

UID=UUID('00000000-0000-0000-0000-000000000002')
@pytest.fixture
def client():
    app.dependency_overrides[current_user]=lambda:CurrentUser(id=UID,token='user-token')
    try:
        with TestClient(app) as c: yield c
    finally: app.dependency_overrides.clear()

def test_support_read_uses_user_rls(client,monkeypatch):
    request=AsyncMock(return_value=[])
    monkeypatch.setattr(gateway,'rows',request)
    assert client.get('/api/support').status_code==200
    assert request.call_args.kwargs['token']=='user-token'
    assert not request.call_args.kwargs.get('admin')

def test_ngo_cannot_review_application_or_set_ticket_status(client,monkeypatch):
    monkeypatch.setattr(gateway,'rows',AsyncMock(return_value=[{'role':'ngo'}]))
    rpc=AsyncMock();monkeypatch.setattr(gateway,'rpc',rpc)
    assert client.post('/api/admin/verification',json={'user_id':str(UID),'approved':True,'note':'Approved'}).status_code==403
    assert client.post(f'/api/support/{UID}/reply',json={'body':'Resolved','status':'resolved'}).status_code==403
    rpc.assert_not_called()

def test_browse_computes_distance_before_rounding_and_removes_full_listings(client,monkeypatch):
    async def rows(table,**kwargs):
        if table=='user_roles': return [{'role':'ngo'}]
        if table=='profiles' and not kwargs.get('admin'): return [{'latitude':22,'longitude':88}]
        if table=='profiles': return [{'id':'donor','verified':True}]
        if table=='food_listings': return [dict(id='available',donor_id='donor',quantity=10,claimed_quantity=2,latitude=22.001,longitude=88.001),dict(id='full',donor_id='donor',quantity=10,claimed_quantity=10,latitude=22,longitude=88)]
        raise AssertionError(table)
    monkeypatch.setattr(gateway,'rows',rows)
    response=client.get('/api/listings')
    assert response.status_code==200
    data=response.json()
    assert len(data)==1 and data[0]['id']=='available'
    assert 0 < data[0]['distance_km'] < 1
    assert data[0]['latitude']==22

def test_received_feedback_is_scoped_to_donor_and_ngo_food(client,monkeypatch):
    calls=[]
    async def rows(table,**kwargs):
        if table=='user_roles': return [{'role':'donor'}]
        calls.append(kwargs);return []
    monkeypatch.setattr(gateway,'rows',rows)
    assert client.get('/api/feedback/received').status_code==200
    assert calls[0]['filters']=={'subject_id':f'eq.{UID}','reviewer_role':'eq.ngo','category':'eq.food'}
    assert calls[0]['token']=='user-token'
