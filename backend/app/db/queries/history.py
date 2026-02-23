from __future__ import annotations

from datetime import datetime
from typing import Any

import asyncpg


async def fetch_history(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
    limit: int = 10000,
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ts, value, text, reason
            FROM history
            WHERE router_sn = $1
              AND equip_type = $2
              AND panel_id = $3
              AND addr = $4
              AND ts >= $5
              AND ts <= $6
            ORDER BY ts ASC
            LIMIT $7
        """, router_sn, equip_type, panel_id, addr, start, end, limit)
    return [dict(r) for r in rows]
