from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.auth import verify_token
from app.config import Settings, get_settings
from app.db.queries.equipment import fetch_equipment_by_object
from app.db.queries.objects import fetch_all_objects, fetch_object_by_sn, update_object_name
from app.deps import get_pool
from app.schemas.objects import ObjectNameUpdate, ObjectOut
from app.services.telemetry import derive_connection_status

router = APIRouter(prefix="/api/objects", tags=["objects"])


def _aggregate_connection_status(statuses: list[str]) -> str:
    """Агрегированный статус связи объекта по его оборудованию."""
    if not statuses:
        return "OFFLINE"
    if any(s == "ONLINE" for s in statuses):
        return "ONLINE"
    if any(s == "DELAY" for s in statuses):
        return "DELAY"
    return "OFFLINE"


async def _calc_object_status(
    pool: asyncpg.Pool, router_sn: str, timeout: int,
) -> str:
    """Статус объекта = наличие связи по last_seen_at любого оборудования."""
    equips = await fetch_equipment_by_object(pool, router_sn)
    statuses = [
        derive_connection_status(eq.get("last_seen_at"), timeout)
        for eq in equips
    ]
    return _aggregate_connection_status(statuses)


@router.get("", response_model=list[ObjectOut])
async def list_objects(
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
    _: str = Depends(verify_token),
):
    rows = await fetch_all_objects(pool)
    results = []
    for row in rows:
        status = await _calc_object_status(
            pool, row["router_sn"], settings.telemetry.offline_timeout_sec,
        )
        results.append(ObjectOut(
            router_sn=row["router_sn"],
            name=row.get("name"),
            notes=row.get("notes"),
            lat=row.get("lat"),
            lon=row.get("lon"),
            equipment_count=row.get("equipment_count", 0),
            status=status,
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

    status = await _calc_object_status(
        pool, row["router_sn"], settings.telemetry.offline_timeout_sec,
    )
    return ObjectOut(
        router_sn=row["router_sn"],
        name=row.get("name"),
        notes=row.get("notes"),
        lat=row.get("lat"),
        lon=row.get("lon"),
        equipment_count=row.get("equipment_count", 0),
        status=status,
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
