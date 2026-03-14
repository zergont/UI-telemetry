from __future__ import annotations

from datetime import datetime
from typing import Any

import asyncpg

# ---------------------------------------------------------------------------
# Логика выбора таблицы по ширине диапазона
# ---------------------------------------------------------------------------
# span ≤ 7 дней  → history (raw, ~2-5 сек)     retention: 7 дней
# span ≤ 30 дней → history_1min (1 мин)          retention: 30 дней
# span > 30 дней → history_1hour (1 час)          retention: 1 год
# ---------------------------------------------------------------------------

_7D  = 7  * 86_400
_30D = 30 * 86_400


def _choose_table(span_seconds: float) -> str:
    if span_seconds <= _7D:
        return "history"
    elif span_seconds <= _30D:
        return "history_1min"
    else:
        return "history_1hour"


async def fetch_history(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    addr: int,
    start: datetime,
    end: datetime,
    limit: int = 20_000,
) -> list[dict[str, Any]]:
    """
    Автоматически выбирает таблицу (raw / 1min / 1hour) по ширине диапазона.
    Всегда возвращает: {ts, value, min_value, max_value, text, reason}.
    min_value/max_value == value для raw-точек.
    """
    span = (end - start).total_seconds()
    table = _choose_table(span)

    async with pool.acquire() as conn:
        if table == "history":
            rows = await conn.fetch("""
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
            """, router_sn, equip_type, panel_id, addr, start, end, limit)
        else:
            rows = await conn.fetch(f"""
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
            """, router_sn, equip_type, panel_id, addr, start, end, limit)

    return [dict(r) for r in rows]
