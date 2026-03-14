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


async def fetch_history(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
    limit: int = TARGET_POINTS,
) -> list[dict[str, Any]]:
    """
    Автоматически выбирает источник данных:
      1. Pre-aggregated таблица (history_1min / history_1hour) — если существует.
      2. Fallback на raw history с on-the-fly SQL-агрегацией — если таблицы нет.

    Возвращает список {ts, value, min_value, max_value, text, reason}.
    min_value/max_value > value только для агрегированных данных.
    """
    span = (end - start).total_seconds()
    table = _choose_table(span)

    async with pool.acquire() as conn:
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
                rows = await _query_raw(
                    conn, router_sn, equip_type, panel_id, addr, start, end, span, limit
                )

    return [dict(r) for r in rows]
