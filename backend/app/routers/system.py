"""Контроль версий и обновление системы."""
from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, Request

from app.auth import AuthContext, require_admin, require_auth
from app.config import APP_VERSION, get_settings
from app.deps import get_pool
from app.services.updater import (
    check_for_updates,
    get_current_version,
    get_status,
    perform_update,
)

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/version")
async def version(ctx: AuthContext = Depends(require_auth)):
    """Текущая версия приложения (из кода, не из config.yaml)."""
    return get_current_version(APP_VERSION)


@router.get("/check-update")
async def check_update(ctx: AuthContext = Depends(require_admin)):
    """Проверить наличие обновлений на GitHub."""
    return await check_for_updates()


@router.post("/update")
async def update(ctx: AuthContext = Depends(require_admin)):
    """Запустить обновление (git pull + pip + npm build)."""
    return await perform_update()


@router.get("/update-status")
async def update_status(ctx: AuthContext = Depends(require_admin)):
    """Текущий статус обновления (для polling)."""
    s = get_status()
    return {
        "state": s.state,
        "progress": s.progress,
        "log": s.log,
        "error": s.error,
        "available": s.available,
    }


@router.get("/diagnostics")
async def diagnostics(
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    """Диагностика: состояние register_catalog, БД, кэша телеметрии."""

    # 1. register_catalog — сколько типов и регистров загружено
    catalog_stats: dict = {}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT equip_type, COUNT(*) AS register_count
                FROM register_catalog
                GROUP BY equip_type
                ORDER BY equip_type
                """
            )
        catalog_stats = {r["equip_type"]: {"register_count": r["register_count"]} for r in rows}
    except Exception as exc:
        catalog_stats = {"error": str(exc)}

    # 2. DB — простая проверка соединения
    db_ok = False
    db_error = None
    db_row_count = None
    try:
        async with pool.acquire() as conn:
            db_row_count = await conn.fetchval("SELECT COUNT(*) FROM latest_state")
        db_ok = True
    except Exception as exc:
        db_error = str(exc)

    # 3. TelemetryHub — сколько устройств в кэше
    hub = request.app.state.hub
    hub_cache_size = len(hub.cache)

    return {
        "catalog": catalog_stats,
        "db": {
            "ok": db_ok,
            "latest_state_rows": db_row_count,
            "error": db_error,
        },
        "hub": {
            "cached_devices": hub_cache_size,
        },
    }
