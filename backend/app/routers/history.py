from __future__ import annotations

from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.auth import verify_token
from app.db.queries.history import fetch_history
from app.deps import get_pool
from app.schemas.history import HistoryPoint

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("/", response_model=list[HistoryPoint])
async def get_history(
    router_sn: str = Query(...),
    equip_type: str = Query(...),
    panel_id: int = Query(...),
    addr: int = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    limit: int = Query(10000, le=50000),
    pool: asyncpg.Pool = Depends(get_pool),
    _: str = Depends(verify_token),
):
    rows = await fetch_history(
        pool, router_sn, equip_type, panel_id, addr, start, end, limit
    )
    return [HistoryPoint(**r) for r in rows]
