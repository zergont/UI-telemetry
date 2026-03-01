from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.registers import fetch_registers
from app.deps import get_pool
from app.schemas.registers import RegisterOut

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
    ctx: AuthContext = Depends(require_auth),
):
    enforce_router_scope(ctx, router_sn)
    rows = await fetch_registers(pool, router_sn, equip_type, panel_id)
    return [RegisterOut(**r) for r in rows]
