from __future__ import annotations

from typing import Any

import asyncpg


async def fetch_notifications(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
) -> list[dict[str, Any]]:
    """Last incident per (addr, bit) from fault_history joined with register_catalog.

    Active faults (fault_end IS NULL) come first, then historical by fault_start DESC.
    fault_name and severity are resolved from register_catalog.states_json.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (f.addr, f.bit)
                f.addr,
                f.bit,
                f.fault_start,
                f.fault_end,
                CASE WHEN f.fault_end IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (f.fault_end - f.fault_start))::int
                    ELSE NULL
                END AS duration_seconds,
                COALESCE(
                    rc.states_json -> f.bit::text ->> 'name_ru',
                    rc.states_json -> f.bit::text ->> 'name'
                )                                             AS fault_name,
                rc.states_json -> f.bit::text ->> 'severity' AS severity
            FROM fault_history f
            LEFT JOIN register_catalog rc
                   ON rc.equip_type = $2 AND rc.addr = f.addr
            WHERE f.router_sn  = $1
              AND f.equip_type = $2
              AND f.panel_id   = $3
            ORDER BY f.addr, f.bit, f.fault_start DESC
            """,
            router_sn, equip_type, panel_id,
        )

    results = [dict(r) for r in rows]
    # Active first, then by descending fault_start
    results.sort(
        key=lambda x: (
            0 if x["fault_end"] is None else 1,
            -(x["fault_start"].timestamp() if x["fault_start"] else 0),
        )
    )
    return results
