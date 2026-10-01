"""Keep endpoint tests independent from the background maintenance lifecycle."""
from unittest.mock import AsyncMock
import pytest


@pytest.fixture(autouse=True)
def isolate_background_maintenance(monkeypatch):
    monkeypatch.setattr('app.main.run_loop', AsyncMock())
