"""Контроль версий и обновление системы."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import AuthContext, require_admin, require_auth
from app.config import get_settings
from app.services.updater import (
    check_for_updates,
    get_current_version,
    get_status,
    perform_update,
)

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/version")
async def version(ctx: AuthContext = Depends(require_auth)):
    """Текущая версия приложения."""
    settings = get_settings()
    return get_current_version(settings.app.version)


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
