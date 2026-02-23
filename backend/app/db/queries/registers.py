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
            SELECT ls.addr, ls.name, ls.value, ls.raw, ls.text,
                   ls.unit, ls.reason, ls.ts, ls.updated_at
            FROM latest_state ls
            WHERE ls.router_sn = $1
              AND ls.equip_type = $2
              AND ls.panel_id = $3
            ORDER BY ls.addr
        """, router_sn, equip_type, panel_id)
    return [dict(r) for r in rows]
