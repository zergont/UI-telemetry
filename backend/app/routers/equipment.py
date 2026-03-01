from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthContext, enforce_router_scope, require_admin, require_auth
from app.config import Settings, get_settings
from app.db.queries.equipment import (
    fetch_equipment_by_object,
    fetch_key_metrics,
    update_equipment_name,
)
from app.deps import get_pool
from app.schemas.equipment import EquipmentNameUpdate, EquipmentOut
from app.services.telemetry import (
    derive_connection_status,
    derive_engine_state,
    fahrenheit_to_celsius,
    is_na,
    seconds_to_motohours,
)

router = APIRouter(prefix="/api/objects/{router_sn}/equipment", tags=["equipment"])


def _build_equipment_out(
    eq: dict,
    metrics: dict[int, dict],
    key_regs,
    offline_timeout: int,
) -> EquipmentOut:
    def _val(addr: int) -> float | None:
        m = metrics.get(addr)
        if not m or is_na(m.get("raw"), m.get("reason")):
            return None
        return m.get("value")

    installed = _val(key_regs.installed_power)
    load = _val(key_regs.current_load)

    hours_raw = _val(key_regs.engine_hours)
    hours = seconds_to_motohours(hours_raw) if hours_raw is not None else None

    temp_raw = _val(key_regs.oil_temp)
    temp_m = metrics.get(key_regs.oil_temp)
    temp_unit = temp_m.get("unit", "") if temp_m else ""
    if temp_raw is not None and temp_unit and "f" in temp_unit.lower():
        temp_c = fahrenheit_to_celsius(temp_raw)
    elif temp_raw is not None:
        temp_c = round(temp_raw, 1)
    else:
        temp_c = None

    pressure = _val(key_regs.oil_pressure)

    state_m = metrics.get(key_regs.engine_state)
    state_text = state_m["text"] if state_m else None
    last_upd = state_m["updated_at"] if state_m else None

    state = derive_engine_state(state_text, last_upd, offline_timeout)
    conn_status = derive_connection_status(eq.get("last_seen_at"), offline_timeout)

    return EquipmentOut(
        router_sn=eq["router_sn"],
        equip_type=eq["equip_type"],
        panel_id=eq["panel_id"],
        name=eq.get("name"),
        first_seen_at=eq.get("first_seen_at"),
        last_seen_at=eq.get("last_seen_at"),
        installed_power_kw=installed,
        current_load_kw=load,
        engine_hours=hours,
        oil_temp_c=temp_c,
        oil_pressure_kpa=pressure,
        engine_state=state,
        connection_status=conn_status,
        last_update=last_upd,
    )


@router.get("", response_model=list[EquipmentOut])
async def list_equipment(
    router_sn: str,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
    ctx: AuthContext = Depends(require_auth),
):
    enforce_router_scope(ctx, router_sn)
    equips = await fetch_equipment_by_object(pool, router_sn)
    results = []
    for eq in equips:
        metrics = await fetch_key_metrics(
            pool, router_sn, eq["equip_type"], eq["panel_id"],
            settings.telemetry.key_registers,
        )
        results.append(_build_equipment_out(
            eq, metrics, settings.telemetry.key_registers,
            settings.telemetry.offline_timeout_sec,
        ))
    return results


@router.patch("/{equip_type}/{panel_id}/name")
async def rename_equipment(
    router_sn: str,
    equip_type: str,
    panel_id: int,
    body: EquipmentNameUpdate,
    pool: asyncpg.Pool = Depends(get_pool),
    _: AuthContext = Depends(require_admin),
):
    ok = await update_equipment_name(pool, router_sn, equip_type, panel_id, body.name)
    if not ok:
        raise HTTPException(status_code=404, detail="Equipment not found")
    return {"ok": True}
