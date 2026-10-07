import asyncio
from unittest.mock import AsyncMock
from app.maintenance import run_once


def test_maintenance_batches_until_empty():
    gateway = AsyncMock()
    gateway.request.side_effect = [100, 20]
    assert asyncio.run(run_once(gateway)) == 120
    assert gateway.request.await_count == 2


def test_maintenance_bounds_cycle():
    gateway = AsyncMock()
    gateway.request.return_value = 100
    assert asyncio.run(run_once(gateway)) == 1000
    assert gateway.request.await_count == 10


def test_loop_retries_after_database_failure(monkeypatch):
    from app import maintenance
    gateway = AsyncMock()
    gateway.request.side_effect = [RuntimeError('unavailable'), 2]
    sleep = AsyncMock(side_effect=[None, asyncio.CancelledError()])
    monkeypatch.setattr(maintenance.asyncio, 'sleep', sleep)
    monkeypatch.setattr(maintenance, 'HEARTBEAT', __import__('unittest.mock', fromlist=['Mock']).Mock())
    async def check():
        try:
            await maintenance.run_loop(gateway)
        except asyncio.CancelledError:
            pass
    asyncio.run(check())
    assert gateway.request.await_count == 2
    assert sleep.await_count == 2
