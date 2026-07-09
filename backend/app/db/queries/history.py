# Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
# Программный комплекс «Честная Генерация»
# Модуль веб-дашборда и визуализации телеметрии
# Автор: Саввиди Александр Анатольевич | ИНН 4725009270
#
# Данное программное обеспечение является конфиденциальным.
# Несанкционированное копирование, распространение или использование
# без письменного разрешения правообладателя запрещено.

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg

from app.config import get_settings

# ─────────────────────────────────────────────────────────────────────────────
# Выбор источника данных по ширине И возрасту диапазона.
#
# Ширина (объём строк):
#   span ≤ 30 дней → history (raw hypertable, time_bucket on-the-fly)
#   span ≤ 90 дней → history_1min  (CA, 1 минута)
#   span >  90 дней → history_1hour (CA, 1 час)
#
# Возраст (retention): raw хранится 30 дней, 1min — 90 дней. Диапазон,
# начинающийся за пределами retention источника, физически пуст в нём —
# берём следующий по грубости источник целиком (без сшивки).
#
# Gap-детекция вынесена в DB_MQTT (таблица data_gaps).
# ─────────────────────────────────────────────────────────────────────────────

_30D = 30 * 86_400
_90D = 90 * 86_400

TARGET_POINTS = 2_000   # желаемое количество точек на графике

# Порог сырых точек: если ширина бакета ≤ 5 сек — отдаём как есть
_RAW_BUCKET_MAX_SECS = 5


def _choose_table(span_seconds: float, start: datetime) -> tuple[str, int]:
    """→ (таблица, базовая гранулярность источника в секундах; 0 = raw)."""
    cfg = get_settings().history
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    age_seconds = (datetime.now(timezone.utc) - start).total_seconds()

    if span_seconds <= _30D and age_seconds <= cfg.raw_retention_days * 86_400:
        return "history", 0
    if span_seconds <= _90D and age_seconds <= cfg.agg_1min_retention_days * 86_400:
        return "history_1min", 60
    return "history_1hour", 3_600


async def _query_aggregated(
    conn: asyncpg.Connection,
    table: str,
    base_resolution: int,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
    span_seconds: float,
    limit: int,
) -> tuple[list, int]:
    """Читает из Continuous Aggregate (history_1min / history_1hour).

    Если строк в диапазоне больше limit — даунсемплит time_bucket'ом
    (взвешенное среднее по sample_count), а не режет хвост LIMIT'ом.
    → (rows, фактическая гранулярность в секундах)
    """
    bucket_secs = max(base_resolution, int(span_seconds / limit) + 1)

    if bucket_secs <= base_resolution:
        # Строк гарантированно ≤ limit — отдаём гранулярность источника
        rows = await conn.fetch(
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
        return rows, base_resolution

    # Диапазон шире, чем limit строк источника — укрупняем бакеты
    rows = await conn.fetch(
        f"""
        SELECT
            time_bucket(make_interval(secs => $1::int), ts)       AS ts,
            sum(avg_value * sample_count)
                / NULLIF(sum(sample_count), 0)                     AS value,
            min(min_value)                                         AS min_value,
            max(max_value)                                         AS max_value,
            first(open_value, ts)                                  AS open_value,
            last(close_value, ts)                                  AS close_value,
            sum(sample_count)::bigint                              AS sample_count,
            NULL::text                                             AS text,
            NULL::text                                             AS reason
        FROM {table}
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
    return rows, bucket_secs


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
) -> tuple[list, int]:
    """Читает из raw hypertable history.

    Для коротких диапазонов возвращает сырые точки (разрешение 0).
    Для длинных — агрегирует on-the-fly через time_bucket (TimescaleDB).
    → (rows, фактическое разрешение в секундах; 0 = raw)
    """
    bucket_secs = max(1, int(span_seconds / limit))

    if bucket_secs <= _RAW_BUCKET_MAX_SECS:
        # Сырые точки — диапазон достаточно короткий
        rows = await conn.fetch(
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
        return rows, 0

    # On-the-fly агрегация через TimescaleDB time_bucket
    rows = await conn.fetch(
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
    return rows, bucket_secs


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
      points          — [{ts, value, min_value, max_value,
                          open_value, close_value, sample_count, text, reason}]
      first_data_at   — самая старая точка по ВСЕМ источникам (граница «данных нет»);
                        не зависит от выбранной таблицы, иначе retention raw (30 дней)
                        запирает пан/зум в 30-дневном окне
      resolution_secs — фактическое разрешение ответа (0 = сырые точки)
    """
    span = (end - start).total_seconds()
    table, base_resolution = _choose_table(span, start)

    async with pool.acquire() as conn:
        if table == "history":
            rows, resolution = await _query_raw(
                conn, router_sn, equip_type, panel_id, addr, start, end, span, limit
            )
        else:
            rows, resolution = await _query_aggregated(
                conn, table, base_resolution,
                router_sn, equip_type, panel_id, addr, start, end, span, limit,
            )

        # LEAST в Postgres игнорирует NULL — вернёт минимум по непустым источникам
        first_data_at = await conn.fetchval(
            """
            SELECT LEAST(
                (SELECT MIN(ts) FROM history
                  WHERE router_sn=$1 AND equip_type=$2 AND panel_id=$3 AND addr=$4),
                (SELECT MIN(ts) FROM history_1min
                  WHERE router_sn=$1 AND equip_type=$2 AND panel_id=$3 AND addr=$4),
                (SELECT MIN(ts) FROM history_1hour
                  WHERE router_sn=$1 AND equip_type=$2 AND panel_id=$3 AND addr=$4)
            )
            """,
            router_sn, equip_type, panel_id, addr,
        )

    points = [dict(r) for r in rows]

    return {
        "points":          points,
        "first_data_at":   first_data_at,
        "resolution_secs": resolution,
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
