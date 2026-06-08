# Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
# Программный комплекс «Честная Генерация»
# Модуль веб-дашборда и визуализации телеметрии
# Автор: Саввиди Александр Анатольевич | ИНН 4725009270
#
# Данное программное обеспечение является конфиденциальным.
# Несанкционированное копирование, распространение или использование
# без письменного разрешения правообладателя запрещено.

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
    installed_addr: int,
    load_addr: int,
) -> dict[str, dict[str, Any]]:
    """Суммарная установленная мощность и нагрузка по всем объектам (один запрос).

    Возвращает dict: {router_sn: {total_installed_power_kw, total_load_kw}}.
    NA-значения (raw 65535/32767 или reason содержит 'NA') исключаются.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                router_sn,
                SUM(value) FILTER (
                    WHERE addr = $1
                      AND (raw IS NULL OR raw NOT IN (65535, 32767))
                ) AS total_installed_power_kw,
                SUM(value) FILTER (
                    WHERE addr = $2
                      AND (raw IS NULL OR raw NOT IN (65535, 32767))
                ) AS total_load_kw
            FROM latest_state
            GROUP BY router_sn
        """, installed_addr, load_addr)
    return {r["router_sn"]: dict(r) for r in rows}


async def fetch_power_totals_single(
    pool: asyncpg.Pool,
    router_sn: str,
    installed_addr: int,
    load_addr: int,
) -> dict[str, Any]:
    """Суммарная мощность/нагрузка для одного объекта из latest_state."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT
                SUM(value) FILTER (
                    WHERE addr = $2
                      AND (raw IS NULL OR raw NOT IN (65535, 32767))
                ) AS total_installed_power_kw,
                SUM(value) FILTER (
                    WHERE addr = $3
                      AND (raw IS NULL OR raw NOT IN (65535, 32767))
                ) AS total_load_kw
            FROM latest_state
            WHERE router_sn = $1
        """, router_sn, installed_addr, load_addr)
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


async def delete_object_cascade(
    pool: asyncpg.Pool, router_sn: str
) -> dict[str, int] | None:
    """Каскадное удаление через хранимую процедуру delete_device().

    Возвращает словарь {table_name: deleted_rows} или None если объект не найден.
    Процедура сама знает все таблицы и выполняется в одной транзакции.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM delete_device($1)", router_sn)

    if not rows:
        return None

    summary = {r["table_name"]: r["deleted_rows"] for r in rows}
    # Объект не найден если objects=0
    if summary.get("objects", 0) == 0:
        return None
    return summary
