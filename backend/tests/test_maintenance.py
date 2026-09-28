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
