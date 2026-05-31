from __future__ import annotations

from typing import Any, Literal

import asyncpg

# Общая часть SELECT для обоих режимов
_SELECT = """
    SELECT
        f.addr,
        f.bit,
        f.fault_start,
        f.fault_end,
        CASE WHEN f.fault_end IS NOT NULL
            THEN EXTRACT(EPOCH FROM (f.fault_end - f.fault_start))::int
            ELSE NULL
        END AS duration_seconds,
        rc.states_json -> f.bit::text ->> 'name_ru' AS fault_name_ru,
        rc.states_json -> f.bit::text ->> 'name'    AS fault_name_en,
        rc.states_json -> f.bit::text ->> 'severity' AS severity
    FROM fault_history f
    LEFT JOIN register_catalog rc
           ON rc.equip_type = $2 AND rc.addr = f.addr
    WHERE f.router_sn  = $1
      AND f.equip_type = $2
      AND f.panel_id   = $3
"""

_SQL_LATEST = _SELECT + """
    -- Одна строка на (addr, bit) — последнее срабатывание
    -- DISTINCT ON требует тех же полей в ORDER BY первыми
    ORDER BY f.addr, f.bit, f.fault_start DESC
"""

_SQL_ALL = _SELECT + """
    ORDER BY f.fault_start DESC
    LIMIT 500
"""


async def fetch_notifications(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    mode: Literal["latest", "all"] = "latest",
) -> list[dict[str, Any]]:
    """Уведомления из fault_history, обогащённые register_catalog.

    mode='latest' — одно (последнее) срабатывание на каждый бит.
    mode='all'    — все инциденты, последние 500 по дате.
    """
    if mode == "latest":
        # DISTINCT ON нельзя смешать с общим _SQL_LATEST через обычный запрос,
        # поэтому формируем запрос явно
        sql = """
            SELECT DISTINCT ON (f.addr, f.bit)
                f.addr,
                f.bit,
                f.fault_start,
                f.fault_end,
                CASE WHEN f.fault_end IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (f.fault_end - f.fault_start))::int
                    ELSE NULL
                END AS duration_seconds,
                rc.states_json -> f.bit::text ->> 'name_ru' AS fault_name_ru,
                rc.states_json -> f.bit::text ->> 'name'    AS fault_name_en,
                rc.states_json -> f.bit::text ->> 'severity' AS severity
            FROM fault_history f
            LEFT JOIN register_catalog rc
                   ON rc.equip_type = $2 AND rc.addr = f.addr
            WHERE f.router_sn  = $1
              AND f.equip_type = $2
              AND f.panel_id   = $3
            ORDER BY f.addr, f.bit, f.fault_start DESC
        """
    else:
        sql = """
            SELECT
                f.addr,
                f.bit,
                f.fault_start,
                f.fault_end,
                CASE WHEN f.fault_end IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (f.fault_end - f.fault_start))::int
                    ELSE NULL
                END AS duration_seconds,
                rc.states_json -> f.bit::text ->> 'name_ru' AS fault_name_ru,
                rc.states_json -> f.bit::text ->> 'name'    AS fault_name_en,
                rc.states_json -> f.bit::text ->> 'severity' AS severity
            FROM fault_history f
            LEFT JOIN register_catalog rc
                   ON rc.equip_type = $2 AND rc.addr = f.addr
            WHERE f.router_sn  = $1
              AND f.equip_type = $2
              AND f.panel_id   = $3
            ORDER BY f.fault_start DESC
            LIMIT 500
        """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, router_sn, equip_type, panel_id)

    results = [dict(r) for r in rows]
    # Активные всегда первыми, затем по убыванию времени начала
    results.sort(
        key=lambda x: (
            0 if x["fault_end"] is None else 1,
            -(x["fault_start"].timestamp() if x["fault_start"] else 0),
        )
    )
    return results
