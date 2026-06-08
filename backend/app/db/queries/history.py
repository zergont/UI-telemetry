# Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
# Программный комплекс «Честная Генерация»
# Модуль веб-дашборда и визуализации телеметрии
# Автор: Саввиди Александр Анатольевич | ИНН 4725009270
#
# Данное программное обеспечение является конфиденциальным.
# Несанкционированное копирование, распространение или использование
# без письменного разрешения правообладателя запрещено.

from __future__ import annotations

from datetime import datetime
from typing import Any

import asyncpg

# ─────────────────────────────────────────────────────────────────────────────
# Выбор источника данных по ширине диапазона
#
#   span ≤ 30 дней → history (raw hypertable, time_bucket on-the-fly)
#   span ≤ 90 дней → history_1min  (CA, 1 минута)
#   span >  90 дней → history_1hour (CA, 1 час)
#
# Gap-детекция вынесена в DB_MQTT (таблица data_gaps).
# ─────────────────────────────────────────────────────────────────────────────

_30D = 30 * 86_400
_90D = 90 * 86_400

TARGET_POINTS = 2_000   # желаемое количество точек на графике


def _choose_table(span_seconds: float) -> str:
    if span_seconds <= _30D:
        return "history"
    elif span_seconds <= _90D:
        return "history_1min"
    else:
        return "history_1hour"


async def _query_aggregated(
    conn: asyncpg.Connection,
    table: str,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
    limit: int,
) -> list:
    """Читает из Continuous Aggregate (history_1min / history_1hour)."""
    return await conn.fetch(
        f"""
        SELECT
            ts,
            avg_value                        AS value,
            min_value,
            max_value,
            open_value,
            close_value,
            sample_count,
            NULL::text                       AS text,
            NULL::text                       AS reason
        FROM {table}
        WHERE router_sn = $1
          AND equip_type = $2
          AND panel_id   = $3
          AND addr       = $4
          AND ts BETWEEN $5 AND $6
        ORDER BY ts ASC
        LIMIT $7
        """,
        router_sn, equip_type, panel_id, addr, start, end, limit,
    )


async def _query_raw(
    conn: asyncpg.Connection,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
    span_seconds: float,
    limit: int,
) -> list:
    """Читает из raw hypertable history.

    Для коротких диапазонов возвращает сырые точки.
    Для длинных — агрегирует on-the-fly через time_bucket (TimescaleDB).
    """
    bucket_secs = max(1, int(span_seconds / limit))

    if bucket_secs <= 5:
        # Сырые точки — диапазон достаточно короткий
        return await conn.fetch(
            """
            SELECT
                ts,
                value,
                value                        AS min_value,
                value                        AS max_value,
                value                        AS open_value,
                value                        AS close_value,
                1::bigint                    AS sample_count,
                NULL::text                   AS text,
                NULL::text                   AS reason
            FROM history
            WHERE router_sn = $1
              AND equip_type = $2
              AND panel_id   = $3
              AND addr       = $4
              AND ts BETWEEN $5 AND $6
            ORDER BY ts ASC
            LIMIT $7
            """,
            router_sn, equip_type, panel_id, addr, start, end, limit * 5,
        )
    else:
        # On-the-fly агрегация через TimescaleDB time_bucket
        return await conn.fetch(
            """
            SELECT
                time_bucket(make_interval(secs => $1::int), ts)  AS ts,
                avg(value)                                        AS value,
                min(value)                                        AS min_value,
                max(value)                                        AS max_value,
                first(value, ts)                                  AS open_value,
                last(value, ts)                                   AS close_value,
                count(*)::bigint                                  AS sample_count,
                NULL::text                                        AS text,
                NULL::text                                        AS reason
            FROM history
            WHERE router_sn = $2
              AND equip_type = $3
              AND panel_id   = $4
              AND addr       = $5
              AND ts BETWEEN $6 AND $7
            GROUP BY 1
            ORDER BY 1
            """,
            bucket_secs,
            router_sn, equip_type, panel_id, addr, start, end,
        )


async def fetch_history(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
    limit: int = TARGET_POINTS,
) -> dict[str, Any]:
    """Выбирает данные из нужного источника.

    Возвращает:
      points        — [{ts, value, min_value, max_value,
                        open_value, close_value, sample_count, text, reason}]
      first_data_at — первая запись в источнике (граница «данных нет»)
    """
    span  = (end - start).total_seconds()
    table = _choose_table(span)

    async with pool.acquire() as conn:
        if table == "history":
            rows = await _query_raw(
                conn, router_sn, equip_type, panel_id, addr, start, end, span, limit
            )
        else:
            rows = await _query_aggregated(
                conn, table, router_sn, equip_type, panel_id, addr, start, end, limit
            )

        first_data_at = await conn.fetchval(
            f"SELECT MIN(ts) FROM {table} "
            "WHERE router_sn=$1 AND equip_type=$2 AND panel_id=$3 AND addr=$4",
            router_sn, equip_type, panel_id, addr,
        )

    points = [dict(r) for r in rows]

    return {
        "points":        points,
        "first_data_at": first_data_at,
    }


async def fetch_journal(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    limit: int = 500,
) -> dict[str, Any]:
    """Журнал enum-состояний из enum_history, обогащённый register_catalog.

    Читает из enum_history (каждая строка — один период состояния).
    label_ru / label — расшифровки из states_json.
    Gracefully degrades to name_default if name_ru column is absent.
    """
    _sql_ru = """
        SELECT
            e.addr,
            COALESCE(r.name_ru, r.name_default)         AS name,
            r.name_default                               AS name_en,
            e.value,
            r.states_json->'labels'   ->> e.value::text AS label,
            r.states_json->'labels_ru'->> e.value::text AS label_ru,
            e.state_start,
            e.state_end,
            EXTRACT(EPOCH FROM (
                COALESCE(e.state_end, now()) - e.state_start
            ))::int                                      AS duration_seconds
        FROM enum_history e
        LEFT JOIN register_catalog r
            ON r.equip_type = e.equip_type AND r.addr = e.addr
        WHERE e.router_sn  = $1
          AND e.equip_type = $2
          AND e.panel_id   = $3
        ORDER BY e.state_start DESC
        LIMIT $4
    """
    _sql_fallback = """
        SELECT
            e.addr,
            r.name_default                               AS name,
            r.name_default                               AS name_en,
            e.value,
            r.states_json->'labels'   ->> e.value::text AS label,
            NULL::text                                   AS label_ru,
            e.state_start,
            e.state_end,
            EXTRACT(EPOCH FROM (
                COALESCE(e.state_end, now()) - e.state_start
            ))::int                                      AS duration_seconds
        FROM enum_history e
        LEFT JOIN register_catalog r
            ON r.equip_type = e.equip_type AND r.addr = e.addr
        WHERE e.router_sn  = $1
          AND e.equip_type = $2
          AND e.panel_id   = $3
        ORDER BY e.state_start DESC
        LIMIT $4
    """
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch(_sql_ru, router_sn, equip_type, panel_id, limit)
        except asyncpg.UndefinedColumnError:
            rows = await conn.fetch(_sql_fallback, router_sn, equip_type, panel_id, limit)
    return {"events": [dict(r) for r in rows]}


async def fetch_state_events(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
) -> dict[str, Any]:
    """Журнал изменений состояния (discrete/enum регистры)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                ts,
                raw,
                NULL::text AS text,
                NULL::text AS write_reason
            FROM state_events
            WHERE router_sn  = $1
              AND equip_type = $2
              AND panel_id   = $3
              AND addr       = $4
              AND ts BETWEEN $5 AND $6
            ORDER BY ts ASC
            """,
            router_sn, equip_type, panel_id, addr, start, end,
        )

    events = [
        {
            "ts":           r["ts"],
            "raw":          r["raw"],
            "text":         r["text"],
            "write_reason": r["write_reason"],
        }
        for r in rows
    ]

    return {"events": events}
