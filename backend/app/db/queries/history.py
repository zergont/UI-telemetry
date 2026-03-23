from __future__ import annotations

from datetime import datetime
from typing import Any

import asyncpg

# ─────────────────────────────────────────────────────────────────────────────
# Выбор источника данных по ширине диапазона
#
# v3.0.0 (uPlot migration):
#   span ≤ 30 дней → history (raw hypertable, time_bucket on-the-fly)
#   span ≤ 90 дней → history_1min  (CA, 1 минута)
#   span >  90 дней → history_1hour (CA, 1 час)
#
# Убрано: _fill_synthetic, _fetch_boundary_points (не нужны для uPlot)
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
    """Читает из Continuous Aggregate (history_1min / history_1hour).

    Возвращает avg/min/max/open/close/sample_count.
    sample_count = NULL означает gap (бакет пустой, заполнен locf).
    """
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
                text,
                reason
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


def _compute_gaps(points: list[dict], min_gap_points: int) -> list[dict]:
    """Находит разрывы (потери данных) между последовательными точками.

    expected_interval = Q1 всех интервалов (устойчив к выбросам).
    threshold = (min_gap_points + 1) × expected_interval.

    Zero-bridge rule: если value до и после разрыва ≈ 0 — не считается потерей
    (оборудование не работало, данные приходили редко).
    """
    if len(points) < 2:
        return []

    diffs = sorted(
        (points[i + 1]["ts"] - points[i]["ts"]).total_seconds()
        for i in range(len(points) - 1)
        if (points[i + 1]["ts"] - points[i]["ts"]).total_seconds() > 0
    )
    if not diffs:
        return []

    expected  = max(diffs[len(diffs) // 4], 1.0)
    threshold = (min_gap_points + 1) * expected

    gaps = []
    for i in range(len(points) - 1):
        diff = (points[i + 1]["ts"] - points[i]["ts"]).total_seconds()
        if diff <= threshold:
            continue
        v0 = points[i].get("value")
        v1 = points[i + 1].get("value")
        zero_bridge = (
            v0 is not None and v1 is not None
            and abs(v0) < 0.001 and abs(v1) < 0.001
        )
        if not zero_bridge:
            gaps.append({"from_ts": points[i]["ts"], "to_ts": points[i + 1]["ts"]})

    return gaps


async def fetch_history(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
    limit: int = TARGET_POINTS,
    min_gap_points: int = 3,
) -> dict[str, Any]:
    """Выбирает данные из нужного источника, определяет gap'ы.

    Возвращает:
      points        — [{ts, value, min_value, max_value,
                        open_value, close_value, sample_count, text, reason}]
      first_data_at — первая запись в источнике (граница «данных нет»)
      gaps          — [{from_ts, to_ts}] красные зоны (потери данных)
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
    gaps = _compute_gaps(points, min_gap_points)

    return {
        "points":        points,
        "first_data_at": first_data_at,
        "gaps":          gaps,
    }


async def fetch_state_events(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
    heartbeat_sec: int = 900,
) -> dict[str, Any]:
    """Журнал изменений состояния (discrete/enum регистры) с детекцией gap'ов.

    Gap = интервал между записями > heartbeat_sec * 2.
    Gap означает потенциально пропущенные события (аварийный останов и т.п.).

    Возвращает:
      events  — [{ts, raw, text, write_reason, gap_after, gap_duration_sec}]
      gaps    — [{from_ts, to_ts}] красные зоны
    """
    gap_threshold = heartbeat_sec * 2

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                ts,
                raw,
                text,
                write_reason,
                lead(ts) OVER (ORDER BY ts)          AS next_ts,
                EXTRACT(EPOCH FROM (
                    lead(ts) OVER (ORDER BY ts) - ts
                ))::float                             AS interval_sec
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

    events = []
    gaps   = []

    for r in rows:
        interval_sec = r["interval_sec"]
        gap_after    = interval_sec is not None and interval_sec > gap_threshold

        events.append({
            "ts":               r["ts"],
            "raw":              r["raw"],
            "text":             r["text"],
            "write_reason":     r["write_reason"],
            "gap_after":        gap_after,
            "gap_duration_sec": round(interval_sec) if gap_after else None,
        })

        if gap_after:
            gaps.append({"from_ts": r["ts"], "to_ts": r["next_ts"]})

    return {
        "events": events,
        "gaps":   gaps,
    }
