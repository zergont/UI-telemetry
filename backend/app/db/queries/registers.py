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

_SQL_WITH_RU = """
    SELECT
        ls.addr,
        ls.value,
        ls.raw,
        rc.name_default,
        rc.name_ru,
        rc.unit_default,
        rc.register_kind,
        rc.states_json
    FROM latest_state ls
    LEFT JOIN register_catalog rc
           ON rc.equip_type = $2 AND rc.addr = ls.addr
    WHERE ls.router_sn  = $1
      AND ls.equip_type = $2
      AND ls.panel_id   = $3
    ORDER BY ls.addr
"""

_SQL_FALLBACK = """
    SELECT
        ls.addr,
        ls.value,
        ls.raw,
        rc.name_default,
        NULL::text        AS name_ru,
        rc.unit_default,
        rc.register_kind,
        rc.states_json
    FROM latest_state ls
    LEFT JOIN register_catalog rc
           ON rc.equip_type = $2 AND rc.addr = ls.addr
    WHERE ls.router_sn  = $1
      AND ls.equip_type = $2
      AND ls.panel_id   = $3
    ORDER BY ls.addr
"""


async def fetch_registers(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
) -> list[dict[str, Any]]:
    """Fetch latest register values joined with catalog metadata.

    Gracefully degrades to NULL name_ru if the column is not yet present.
    """
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch(_SQL_WITH_RU, router_sn, equip_type, panel_id)
        except asyncpg.UndefinedColumnError:
            # name_ru column not yet in register_catalog — fall back
            rows = await conn.fetch(_SQL_FALLBACK, router_sn, equip_type, panel_id)
    return [dict(r) for r in rows]
