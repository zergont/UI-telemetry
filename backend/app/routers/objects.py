from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.auth import verify_token
from app.config import Settings, get_settings
from app.db.queries.equipment import fetch_equipment_by_object, fetch_key_metrics
from app.db.queries.objects import fetch_all_objects, fetch_object_by_sn, update_object_name
from app.deps import get_pool
from app.schemas.objects import ObjectNameUpdate, ObjectOut
from app.services.telemetry import derive_engine_state

router = APIRouter(prefix="/api/objects", tags=["objects"])


def _object_status(equip_states: list[str]) -> str:
    if not equip_states:
        return "OFFLINE"
    if any(s == "ALARM" for s in equip_states):
        return "ALARM"
    if any(s == "RUN" for s in equip_states):
        return "RUN"
    if all(s == "OFFLINE" for s in equip_states):
        return "OFFLINE"
    return "STOP"


@router.get("", response_model=list[ObjectOut])
async def list_objects(
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
    _: str = Depends(verify_token),
):
    rows = await fetch_all_objects(pool)
    results = []
    for row in rows:
        # Fetch equipment statuses for this object
        equips = await fetch_equipment_by_object(pool, row["router_sn"])
        equip_states = []
        for eq in equips:
            metrics = await fetch_key_metrics(
                pool, row["router_sn"], eq["equip_type"], eq["panel_id"],
                settings.telemetry.key_registers,
            )
            state_reg = metrics.get(settings.telemetry.key_registers.engine_state)
            state_text = state_reg["text"] if state_reg else None
            last_upd = state_reg["updated_at"] if state_reg else None
            equip_states.append(
                derive_engine_state(state_text, last_upd, settings.telemetry.offline_timeout_sec)
            )

        results.append(ObjectOut(
            router_sn=row["router_sn"],
            name=row.get("name"),
            notes=row.get("notes"),
            lat=row.get("lat"),
            lon=row.get("lon"),
            equipment_count=row.get("equipment_count", 0),
            status=_object_status(equip_states),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        ))
    return results


@router.get("/{router_sn}", response_model=ObjectOut)
async def get_object(
    router_sn: str,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
    _: str = Depends(verify_token),
):
    row = await fetch_object_by_sn(pool, router_sn)
    if not row:
        raise HTTPException(status_code=404, detail="Object not found")

    # Рассчитать агрегированный статус (как в list_objects)
    equips = await fetch_equipment_by_object(pool, row["router_sn"])
    equip_states = []
    for eq in equips:
        metrics = await fetch_key_metrics(
            pool, row["router_sn"], eq["equip_type"], eq["panel_id"],
            settings.telemetry.key_registers,
        )
        state_reg = metrics.get(settings.telemetry.key_registers.engine_state)
        state_text = state_reg["text"] if state_reg else None
        last_upd = state_reg["updated_at"] if state_reg else None
        equip_states.append(
            derive_engine_state(state_text, last_upd, settings.telemetry.offline_timeout_sec)
        )

    return ObjectOut(
        router_sn=row["router_sn"],
        name=row.get("name"),
        notes=row.get("notes"),
        lat=row.get("lat"),
        lon=row.get("lon"),
        equipment_count=row.get("equipment_count", 0),
        status=_object_status(equip_states),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


@router.patch("/{router_sn}")
async def rename_object(
    router_sn: str,
    body: ObjectNameUpdate,
    pool: asyncpg.Pool = Depends(get_pool),
    _: str = Depends(verify_token),
):
    ok = await update_object_name(pool, router_sn, body.name)
    if not ok:
        raise HTTPException(status_code=404, detail="Object not found")
    return {"ok": True}
