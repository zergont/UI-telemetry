from __future__ import annotations

from typing import Any

import asyncpg


async def fetch_registers(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
) -> list[dict[str, Any]]:
    """Fetch latest register values joined with catalog metadata."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                ls.addr,
                ls.value,
                ls.raw,
                rc.name_default,
                rc.name_ru,
                rc.unit_default,
                rc.register_kind,
                rc.states_json
            FROM latest_state ls
            LEFT JOIN register_catalog rc
                   ON rc.equip_type = $2 AND rc.addr = ls.addr
            WHERE ls.router_sn  = $1
              AND ls.equip_type = $2
              AND ls.panel_id   = $3
            ORDER BY ls.addr
            """,
            router_sn, equip_type, panel_id,
        )
    return [dict(r) for r in rows]
