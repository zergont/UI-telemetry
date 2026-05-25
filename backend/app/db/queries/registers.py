from __future__ import annotations

from typing import Any

import asyncpg


async def fetch_registers(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT addr, value, raw
            FROM latest_state
            WHERE router_sn = $1
              AND equip_type = $2
              AND panel_id = $3
            ORDER BY addr
        """, router_sn, equip_type, panel_id)
    return [dict(r) for r in rows]
