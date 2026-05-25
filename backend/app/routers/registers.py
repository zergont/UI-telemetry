from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.registers import fetch_registers
from app.deps import get_map_store, get_pool
from app.mqtt.map_store import MapStore
from app.schemas.registers import RegisterOut
from app.services.enrichment import enrich_register

router = APIRouter(prefix="/api/registers", tags=["registers"])


@router.get(
    "/{router_sn}/{equip_type}/{panel_id}",
    response_model=list[RegisterOut],
)
async def get_registers(
    router_sn: str,
    equip_type: str,
    panel_id: int,
    pool: asyncpg.Pool = Depends(get_pool),
    map_store: MapStore = Depends(get_map_store),
    ctx: AuthContext = Depends(require_auth),
):
    enforce_router_scope(ctx, router_sn)
    rows = await fetch_registers(pool, router_sn, equip_type, panel_id)
    result = []
    for r in rows:
        enriched = enrich_register(equip_type, r["addr"], r["value"], r["raw"], map_store)
        result.append(RegisterOut(
            **enriched,
            reason=r.get("reason"),
            ts=r.get("ts"),
            updated_at=r.get("updated_at"),
        ))
    return result
