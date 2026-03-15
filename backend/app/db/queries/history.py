from __future__ import annotations

from datetime import datetime
from typing import Any

import asyncpg

# ---------------------------------------------------------------------------
# Выбор таблицы по ширине диапазона (когда агрегатные таблицы уже созданы)
# ---------------------------------------------------------------------------
# span ≤ 7 дней  → history (raw, ~2-5 сек)     retention: 7 дней
# span ≤ 30 дней → history_1min (1 мин)          retention: 30 дней
# span > 30 дней → history_1hour (1 час)          retention: 1 год
# ---------------------------------------------------------------------------

_7D  = 7  * 86_400
_30D = 30 * 86_400

TARGET_POINTS = 2_000   # желаемое кол-во точек на графике


def _choose_table(span_seconds: float) -> str:
    if span_seconds <= _7D:
        return "history"
    elif span_seconds <= _30D:
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
    """Читает из pre-aggregated таблицы (history_1min / history_1hour)."""
    return await conn.fetch(
        f"""
        SELECT
            ts,
            avg_value  AS value,
            min_value,
            max_value,
            NULL::text AS text,
            NULL::text AS reason
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
    """
    Читает из raw-таблицы history.
    Для коротких диапазонов — возвращает сырые точки.
    Для длинных — агрегирует on-the-fly через SQL time-bucket.
    """
    bucket_secs = max(1, int(span_seconds / limit))

    if bucket_secs <= 5:
        # Сырые точки — диапазон достаточно короткий
        return await conn.fetch(
            """
            SELECT
                ts,
                value,
                value   AS min_value,
                value   AS max_value,
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
        # On-the-fly агрегация из raw по временным корзинам
        return await conn.fetch(
            """
            SELECT
                to_timestamp(
                    floor(extract(epoch from ts) / $1) * $1
                ) AT TIME ZONE 'UTC'            AS ts,
                AVG(value)                      AS value,
                MIN(value)                      AS min_value,
                MAX(value)                      AS max_value,
                NULL::text                      AS text,
                NULL::text                      AS reason
            FROM history
            WHERE router_sn = $2
              AND equip_type = $3
              AND panel_id   = $4
              AND addr       = $5
              AND ts BETWEEN $6 AND $7
            GROUP BY 1
            ORDER BY 1
            """,
            float(bucket_secs),
            router_sn, equip_type, panel_id, addr, start, end,
        )


def _compute_gaps(points: list[dict], min_gap_points: int) -> list[dict]:
    """
    Находит разрывы (потери данных) между последовательными точками.

    expected_interval = Q1 всех интервалов между точками (устойчив к выбросам).
    threshold = (min_gap_points + 1) × expected_interval.

    Правило нулевого моста:
      если value до разрыва ≈ 0 И value после ≈ 0 — не считается потерей данных
      (оборудование не работало, точки приходили редко).
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

    # Q1 — базовый интервал, устойчивый к большим разрывам в данных
    expected = max(diffs[len(diffs) // 4], 1.0)
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
    """
    Автоматически выбирает источник данных:
      1. Pre-aggregated таблица (history_1min / history_1hour) — если существует.
      2. Fallback на raw history с on-the-fly SQL-агрегацией — если таблицы нет.

    Возвращает:
      points        — список точек {ts, value, min_value, max_value, text, reason}
      first_data_at — первая запись в raw-таблице history (для серой зоны)
      gaps          — разрывы данных (красные зоны) [{from_ts, to_ts}]
    """
    span = (end - start).total_seconds()
    table = _choose_table(span)

    async with pool.acquire() as conn:
        actual_table = table  # таблица, из которой реально читаем данные
        if table == "history":
            rows = await _query_raw(
                conn, router_sn, equip_type, panel_id, addr, start, end, span, limit
            )
        else:
            try:
                rows = await _query_aggregated(
                    conn, table, router_sn, equip_type, panel_id, addr, start, end, limit
                )
            except asyncpg.UndefinedTableError:
                # Агрегатная таблица ещё не создана → fallback на raw history
                actual_table = "history"
                rows = await _query_raw(
                    conn, router_sn, equip_type, panel_id, addr, start, end, span, limit
                )

        # Первая запись в той же таблице, что используется для данных
        # (граница серой зоны «данных нет»)
        first_data_at = await conn.fetchval(
            f"""
            SELECT MIN(ts) FROM {actual_table}
            WHERE router_sn = $1
              AND equip_type = $2
              AND panel_id   = $3
              AND addr       = $4
            """,
            router_sn, equip_type, panel_id, addr,
        )

    points = [dict(r) for r in rows]
    gaps = _compute_gaps(points, min_gap_points)

    return {
        "points": points,
        "first_data_at": first_data_at,
        "gaps": gaps,
    }
