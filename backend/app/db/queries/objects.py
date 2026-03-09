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


async def fetch_power_totals_bulk(
    pool: asyncpg.Pool,
) -> dict[str, dict[str, Any]]:
    """Суммарная установленная мощность и нагрузка по всем объектам (один запрос).

    Читает из таблицы equipment — там хранятся уже вычисленные значения
    installed_power_kw / current_load_kw, которые надёжнее чем latest_state
    (в latest_state регистры могут иметь raw=65535/NA для части устройств).

    Возвращает dict: {router_sn: {total_installed_power_kw, total_load_kw}}.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                router_sn,
                SUM(installed_power_kw) AS total_installed_power_kw,
                SUM(current_load_kw)    AS total_load_kw
            FROM equipment
            GROUP BY router_sn
        """)
    return {r["router_sn"]: dict(r) for r in rows}


async def fetch_power_totals_single(
    pool: asyncpg.Pool,
    router_sn: str,
) -> dict[str, Any]:
    """Суммарная мощность/нагрузка для одного объекта из таблицы equipment."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT
                SUM(installed_power_kw) AS total_installed_power_kw,
                SUM(current_load_kw)    AS total_load_kw
            FROM equipment
            WHERE router_sn = $1
        """, router_sn)
    return dict(row) if row else {}


async def check_object_last_activity(
    pool: asyncpg.Pool, router_sn: str,
) -> dict[str, Any] | None:
    """Проверить, существует ли объект и когда были последние данные.

    Возвращает {exists: True, last_activity: datetime|None} или None.
    last_activity — максимум из equipment.last_seen_at для этого объекта.
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT
                o.router_sn,
                (SELECT MAX(e.last_seen_at) FROM equipment e
                 WHERE e.router_sn = o.router_sn) AS last_activity
            FROM objects o
            WHERE o.router_sn = $1
        """, router_sn)
    if not row:
        return None
    return dict(row)


async def delete_object_cascade(pool: asyncpg.Pool, router_sn: str) -> bool:
    """Каскадное удаление объекта и всех связанных данных в одной транзакции."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Порядок: от вложенных к корню
            await conn.execute(
                "DELETE FROM history WHERE router_sn = $1", router_sn)
            await conn.execute(
                "DELETE FROM latest_state WHERE router_sn = $1", router_sn)
            await conn.execute(
                "DELETE FROM events WHERE router_sn = $1", router_sn)
            await conn.execute(
                "DELETE FROM equipment WHERE router_sn = $1", router_sn)
            await conn.execute(
                "DELETE FROM gps_latest_filtered WHERE router_sn = $1", router_sn)
            # Ревокнуть share-ссылки (soft-delete)
            await conn.execute(
                "UPDATE share_links SET revoked_at = now() "
                "WHERE scope_type = 'site' AND scope_id = $1 AND revoked_at IS NULL",
                router_sn,
            )
            result = await conn.execute(
                "DELETE FROM objects WHERE router_sn = $1", router_sn)
    return result == "DELETE 1"
