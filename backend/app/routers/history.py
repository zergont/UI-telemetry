from __future__ import annotations

from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.history import fetch_history, fetch_state_events
from app.deps import get_pool
from app.schemas.history import (
    HistoryPoint,
    HistoryResponse,
    StateEvent,
    StateEventsResponse,
)

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
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    enforce_router_scope(ctx, router_sn)
    result = await fetch_history(
        pool, router_sn, equip_type, panel_id, addr, start, end,
        limit=points,
    )
    return HistoryResponse(
        points=[HistoryPoint(**p) for p in result["points"]],
        first_data_at=result["first_data_at"],
    )


@router.get("/state-events", response_model=StateEventsResponse)
async def get_state_events(
    router_sn: str = Query(...),
    equip_type: str = Query(...),
    panel_id: int = Query(...),
    addr: int = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    """Журнал изменений состояния (discrete / enum регистры)."""
    enforce_router_scope(ctx, router_sn)
    result = await fetch_state_events(
        pool, router_sn, equip_type, panel_id, addr, start, end,
    )
    return StateEventsResponse(
        events=[StateEvent(**e) for e in result["events"]],
    )
