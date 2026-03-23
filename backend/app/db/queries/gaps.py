from __future__ import annotations

from datetime import datetime

import asyncpg


async def fetch_gaps(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    start: datetime,
    end: datetime,
) -> list[dict]:
    """Выбрать gap'ы, пересекающиеся с диапазоном [start, end].

    Gap пересекается если:
      gap_start < end AND (gap_end > start OR gap_end IS NULL)
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT gap_start, gap_end
            FROM data_gaps
            WHERE router_sn  = $1
              AND equip_type = $2
              AND panel_id   = $3
              AND gap_start  < $5
              AND (gap_end   > $4 OR gap_end IS NULL)
            ORDER BY gap_start ASC
            """,
            router_sn, equip_type, panel_id, start, end,
        )

    return [
        {
            "gap_start": r["gap_start"],
            "gap_end": r["gap_end"],
        }
        for r in rows
    ]
