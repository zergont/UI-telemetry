from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthContext, require_admin, require_auth
from app.config import Settings, get_settings
from app.db.queries.equipment import fetch_equipment_by_object
from app.db.queries.objects import (
    check_object_last_activity,
    delete_object_cascade,
    fetch_all_objects,
    fetch_object_by_sn,
    fetch_power_totals_bulk,
    fetch_power_totals_single,
    update_object_name,
)
from app.deps import get_pool
from app.schemas.objects import ObjectNameUpdate, ObjectOut
from app.services.telemetry import derive_connection_status

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/objects", tags=["objects"])

# Минимальное время тишины перед удалением (нет данных от объекта)
DELETE_QUIET_MINUTES = 30


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
    ctx: AuthContext = Depends(require_auth),
):
    rows = await fetch_all_objects(pool)

    # Scope filtering: viewer с scope=site видит только свой объект
    if ctx.allowed_router_sns is not None:
        rows = [r for r in rows if r["router_sn"] in ctx.allowed_router_sns]

    power_map = await fetch_power_totals_bulk(pool)

    results = []
    for row in rows:
        status = await _calc_object_status(
            pool, row["router_sn"], settings.telemetry.offline_timeout_sec,
        )
        pw = power_map.get(row["router_sn"], {})
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
            total_installed_power_kw=pw.get("total_installed_power_kw"),
            total_load_kw=pw.get("total_load_kw"),
        ))
    return results


@router.get("/{router_sn}", response_model=ObjectOut)
async def get_object(
    router_sn: str,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
    ctx: AuthContext = Depends(require_auth),
):
    # Scope check
    if ctx.allowed_router_sns is not None and router_sn not in ctx.allowed_router_sns:
        raise HTTPException(status_code=403, detail="Access denied to this object")

    row = await fetch_object_by_sn(pool, router_sn)
    if not row:
        raise HTTPException(status_code=404, detail="Object not found")

    status, pw = await asyncio.gather(
        _calc_object_status(pool, router_sn, settings.telemetry.offline_timeout_sec),
        fetch_power_totals_single(pool, router_sn),
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
        total_installed_power_kw=pw.get("total_installed_power_kw"),
        total_load_kw=pw.get("total_load_kw"),
    )


@router.patch("/{router_sn}")
async def rename_object(
    router_sn: str,
    body: ObjectNameUpdate,
    pool: asyncpg.Pool = Depends(get_pool),
    _: AuthContext = Depends(require_admin),
):
    ok = await update_object_name(pool, router_sn, body.name)
    if not ok:
        raise HTTPException(status_code=404, detail="Object not found")
    return {"ok": True}


@router.delete("/{router_sn}")
async def delete_object(
    router_sn: str,
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_admin),
):
    """Полное каскадное удаление объекта и всех его данных.

    Проверяет, что с момента последних данных прошло >= 30 минут
    (объект не передаёт данные).
    """
    info = await check_object_last_activity(pool, router_sn)
    if not info:
        raise HTTPException(status_code=404, detail="Object not found")

    last = info.get("last_activity")
    if last is not None:
        now = datetime.now(timezone.utc)
        if isinstance(last, datetime) and last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        quiet = now - last
        if quiet < timedelta(minutes=DELETE_QUIET_MINUTES):
            remaining = DELETE_QUIET_MINUTES - int(quiet.total_seconds() // 60)
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Объект передавал данные менее {DELETE_QUIET_MINUTES} мин. назад. "
                    f"Остановите передачу и подождите ещё ~{remaining} мин."
                ),
            )

    ok = await delete_object_cascade(pool, router_sn)
    if not ok:
        raise HTTPException(status_code=404, detail="Object not found")

    logger.info(
        "Объект %s удалён администратором (IP: %s)",
        router_sn, ctx.client_ip,
    )
    return {"ok": True, "deleted": router_sn}
