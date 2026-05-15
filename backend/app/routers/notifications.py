from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

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
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    """Активные и последние исторические уведомления (fault_bitmap)."""
    enforce_router_scope(ctx, router_sn)
    rows = await fetch_notifications(pool, router_sn, equip_type, panel_id)
    return [NotificationOut(**r) for r in rows]
