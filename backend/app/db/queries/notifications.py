from __future__ import annotations

from typing import Any

import asyncpg


async def fetch_notifications(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
) -> list[dict[str, Any]]:
    """Последний инцидент на каждый (addr, bit) из fault_history.

    Активные (fault_end IS NULL) возвращаются первыми,
    далее — исторические по убыванию fault_start.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (addr, bit)
                addr,
                bit,
                fault_name,
                severity,
                fault_start,
                fault_end,
                CASE WHEN fault_end IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (fault_end - fault_start))::int
                    ELSE NULL
                END AS duration_seconds
            FROM fault_history
            WHERE router_sn  = $1
              AND equip_type = $2
              AND panel_id   = $3
            ORDER BY addr, bit, fault_start DESC
            """,
            router_sn, equip_type, panel_id,
        )

    results = [dict(r) for r in rows]
    # Активные сначала, затем по убыванию fault_start
    results.sort(
        key=lambda x: (
            0 if x["fault_end"] is None else 1,
            -(x["fault_start"].timestamp() if x["fault_start"] else 0),
        )
    )
    return results
