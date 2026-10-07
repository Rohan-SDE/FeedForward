"""Run with python -m app.maintenance; also hosted by the API lifespan."""
import asyncio
import logging
import time
from pathlib import Path
from .config import get_settings
from .supabase import SupabaseGateway

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
HEARTBEAT = Path('/tmp/feedforward-maintenance.heartbeat')


async def run_once(gateway: SupabaseGateway) -> int:
    total = 0
    # Bound each cycle; repeat next minute if more work remains.
    for _ in range(10):
        count = await gateway.request('POST', 'rpc/expire_food_batch', admin=True, json={'_batch': 100})
        total += int(count or 0)
        if count < 100:
            break
    return total


async def run_loop(gateway: SupabaseGateway) -> None:
    while True:
        try:
            expired = await run_once(gateway)
            HEARTBEAT.write_text(str(time.time()))
            logging.getLogger("uvicorn.error").info('maintenance_ok expired=%s', expired)
        except Exception:
            logging.getLogger("uvicorn.error").error('maintenance_failed; retrying in 60 seconds')
        await asyncio.sleep(60)


async def main() -> None:
    gateway = SupabaseGateway(get_settings())
    try:
        await run_loop(gateway)
    finally:
        await gateway.close()


if __name__ == '__main__':
    asyncio.run(main())
