from __future__ import annotations

from typing import Any

import asyncpg


async def fetch_all_objects(pool: asyncpg.Pool) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                o.router_sn, o.name, o.notes, o.created_at, o.updated_at,
                g.lat, g.lon,
                (SELECT COUNT(*) FROM equipment e
                 WHERE e.router_sn = o.router_sn) AS equipment_count
            FROM objects o
            LEFT JOIN gps_latest_filtered g ON g.router_sn = o.router_sn
            ORDER BY o.name NULLS LAST, o.router_sn
        """)
    return [dict(r) for r in rows]


async def fetch_object_by_sn(pool: asyncpg.Pool, router_sn: str) -> dict[str, Any] | None:
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT
                o.router_sn, o.name, o.notes, o.created_at, o.updated_at,
                g.lat, g.lon,
                (SELECT COUNT(*) FROM equipment e
                 WHERE e.router_sn = o.router_sn) AS equipment_count
            FROM objects o
            LEFT JOIN gps_latest_filtered g ON g.router_sn = o.router_sn
            WHERE o.router_sn = $1
        """, router_sn)
    return dict(row) if row else None


async def update_object_name(pool: asyncpg.Pool, router_sn: str, name: str) -> bool:
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE objects SET name = $1, updated_at = now() WHERE router_sn = $2",
            name, router_sn,
        )
    return result == "UPDATE 1"
