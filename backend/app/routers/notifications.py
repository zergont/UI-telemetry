from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.notifications import fetch_notifications
from app.deps import get_map_store, get_pool
from app.mqtt.map_store import MapStore
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
    map_store: MapStore = Depends(get_map_store),
    ctx: AuthContext = Depends(require_auth),
):
    """Активные и последние исторические уведомления (fault_bitmap)."""
    enforce_router_scope(ctx, router_sn)
    rows = await fetch_notifications(pool, router_sn, equip_type, panel_id)

    result = []
    for r in rows:
        # Обогащение из MapStore: имя и severity берём из описания битов
        meta = map_store.get(equip_type, r["addr"])
        bit_info: dict = {}
        if meta and meta.get("bits"):
            bit_info = meta["bits"].get(str(r["bit"])) or {}

        result.append(NotificationOut(
            addr=r["addr"],
            bit=r["bit"],
            fault_name=bit_info.get("name"),
            fault_description=bit_info.get("name_ru"),
            severity=bit_info.get("severity"),
            fault_start=r["fault_start"],
            fault_end=r["fault_end"],
            duration_seconds=r["duration_seconds"],
        ))

    return result
