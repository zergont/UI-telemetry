from __future__ import annotations

from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.history import fetch_history
from app.deps import get_pool
from app.schemas.history import HistoryPoint

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("", response_model=list[HistoryPoint])
async def get_history(
    router_sn: str = Query(...),
    equip_type: str = Query(...),
    panel_id: int = Query(...),
    addr: int = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    enforce_router_scope(ctx, router_sn)
    # Таблица выбирается автоматически в fetch_history по span:
    #   ≤ 7d  → history (raw)
    #   ≤ 30d → history_1min
    #   > 30d → history_1hour
    rows = await fetch_history(
        pool, router_sn, equip_type, panel_id, addr, start, end,
    )
    return [HistoryPoint(**r) for r in rows]
