from __future__ import annotations

from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.history import fetch_history
from app.deps import get_pool
from app.schemas.history import HistoryPoint

router = APIRouter(prefix="/api/history", tags=["history"])


MAX_CHART_POINTS = 3000


@router.get("", response_model=list[HistoryPoint])
async def get_history(
    router_sn: str = Query(...),
    equip_type: str = Query(...),
    panel_id: int = Query(...),
    addr: int = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    limit: int = Query(10000, le=50000),
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    enforce_router_scope(ctx, router_sn)
    span = (end - start).total_seconds()
    # Auto-downsample for ranges > 24h (assume ~1 record per 30s)
    if span > 86400 and span / 30 > MAX_CHART_POINTS:
        bucket_seconds = max(1, int(span / MAX_CHART_POINTS))
    else:
        bucket_seconds = 0

    rows = await fetch_history(
        pool, router_sn, equip_type, panel_id, addr, start, end,
        limit=limit, bucket_seconds=bucket_seconds,
    )
    return [HistoryPoint(**r) for r in rows]
