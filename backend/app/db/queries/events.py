from __future__ import annotations

import json
from typing import Any

import asyncpg


async def fetch_events(
    pool: asyncpg.Pool,
    router_sn: str | None = None,
    equip_type: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conditions = []
    params: list[Any] = []
    idx = 1

    if router_sn:
        conditions.append(f"router_sn = ${idx}")
        params.append(router_sn)
        idx += 1
    if equip_type:
        conditions.append(f"equip_type = ${idx}")
        params.append(equip_type)
        idx += 1

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    params.append(limit)
    params.append(offset)

    async with pool.acquire() as conn:
        rows = await conn.fetch(f"""
            SELECT id, router_sn, equip_type, panel_id, type,
                   description, payload, created_at
            FROM events
            {where}
            ORDER BY created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """, *params)

    result = []
    for r in rows:
        d = dict(r)
        if d.get("payload") and isinstance(d["payload"], str):
            d["payload"] = json.loads(d["payload"])
        result.append(d)
    return result
