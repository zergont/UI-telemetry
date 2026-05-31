from __future__ import annotations

from typing import Literal

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.notifications import fetch_notifications
from app.deps import get_pool
from app.schemas.notifications import NotificationOut

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get(
    "/{router_sn}/{equip_type}/{panel_id}",
    response_model=list[NotificationOut],
)
async def get_notifications(
    router_sn: str,
    equip_type: str,
    panel_id: int,
    mode: Literal["latest", "all"] = Query("latest"),
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    """Уведомления из fault_history.

    mode=latest — последнее срабатывание на каждый бит (по умолчанию).
    mode=all    — все инциденты, последние 500.
    """
    enforce_router_scope(ctx, router_sn)
    rows = await fetch_notifications(pool, router_sn, equip_type, panel_id, mode=mode)
    return [
        NotificationOut(
            addr=r["addr"],
            bit=r["bit"],
            fault_name=r["fault_name_en"],
            fault_description=r["fault_name_ru"],
            severity=r["severity"],
            fault_start=r["fault_start"],
            fault_end=r["fault_end"],
            duration_seconds=r["duration_seconds"],
        )
        for r in rows
    ]
