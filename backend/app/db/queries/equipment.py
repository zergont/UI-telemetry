from __future__ import annotations

from typing import Any

import asyncpg

from app.config import KeyRegisters


async def fetch_equipment_by_object(
    pool: asyncpg.Pool, router_sn: str
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT router_sn, equip_type, panel_id, name,
                   first_seen_at, last_seen_at
            FROM equipment
            WHERE router_sn = $1
            ORDER BY equip_type, panel_id
        """, router_sn)
    return [dict(r) for r in rows]


async def fetch_key_metrics(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    key_regs: KeyRegisters,
) -> dict[int, dict[str, Any]]:
    addrs = [
        key_regs.installed_power,
        key_regs.current_load,
        key_regs.engine_hours,
        key_regs.oil_temp,
        key_regs.oil_pressure,
        key_regs.engine_state,
    ]
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT addr, value, raw, text, unit, reason, ts, updated_at
            FROM latest_state
            WHERE router_sn = $1 AND equip_type = $2 AND panel_id = $3
              AND addr = ANY($4::int[])
        """, router_sn, equip_type, panel_id, addrs)

    return {r["addr"]: dict(r) for r in rows}


async def update_equipment_name(
    pool: asyncpg.Pool,
    router_sn: str,
    equip_type: str,
    panel_id: int,
    name: str,
) -> bool:
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE equipment SET name = $1 "
            "WHERE router_sn = $2 AND equip_type = $3 AND panel_id = $4",
            name, router_sn, equip_type, panel_id,
        )
    return result == "UPDATE 1"
