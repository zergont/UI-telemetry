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
    bucket_seconds: int = 0,
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        if bucket_seconds > 0:
            # Downsampled: aggregate by time bucket for large ranges
            rows = await conn.fetch("""
                SELECT
                    to_timestamp(
                        floor(extract(epoch FROM ts) / $7) * $7
                    ) AT TIME ZONE 'UTC' AS ts,
                    avg(value) AS value,
                    NULL::text AS text,
                    NULL::text AS reason
                FROM history
                WHERE router_sn = $1
                  AND equip_type = $2
                  AND panel_id = $3
                  AND addr = $4
                  AND ts >= $5
                  AND ts <= $6
                GROUP BY 1
                ORDER BY 1
            """, router_sn, equip_type, panel_id, addr, start, end,
                float(bucket_seconds))
        else:
            # Raw data for small ranges
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
