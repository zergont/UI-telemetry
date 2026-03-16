from __future__ import annotations

from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.history import fetch_history
from app.deps import get_pool
from app.schemas.history import GapZone, HistoryPoint, HistoryResponse

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("", response_model=HistoryResponse)
async def get_history(
    router_sn: str = Query(...),
    equip_type: str = Query(...),
    panel_id: int = Query(...),
    addr: int = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    points: int = Query(2000, ge=100, le=20000),
    min_gap_points: int = Query(3, ge=1, le=20),
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    enforce_router_scope(ctx, router_sn)
    # Таблица выбирается автоматически в fetch_history по span:
    #   ≤ 7d  → history (raw)
    #   ≤ 30d → history_1min
    #   > 30d → history_1hour
    result = await fetch_history(
        pool, router_sn, equip_type, panel_id, addr, start, end,
        limit=points, min_gap_points=min_gap_points,
    )
    return HistoryResponse(
        points=[HistoryPoint(**p) for p in result["points"]],
        first_data_at=result["first_data_at"],
        gaps=[GapZone(**g) for g in result["gaps"]],
    )
