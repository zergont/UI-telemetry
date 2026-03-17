from __future__ import annotations

from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.history import fetch_history, fetch_state_events
from app.deps import get_pool
from app.schemas.history import (
    GapZone,
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
    min_gap_points: int = Query(3, ge=1, le=20),
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    enforce_router_scope(ctx, router_sn)
    # Таблица выбирается автоматически в fetch_history по span:
    #   ≤ 30d → history (raw / on-the-fly time_bucket)
    #   ≤ 90d → history_1min  (Continuous Aggregate, 1 минута)
    #   > 90d → history_1hour (Continuous Aggregate, 1 час)
    result = await fetch_history(
        pool, router_sn, equip_type, panel_id, addr, start, end,
        limit=points, min_gap_points=min_gap_points,
    )
    return HistoryResponse(
        points=[HistoryPoint(**p) for p in result["points"]],
        first_data_at=result["first_data_at"],
        gaps=[GapZone(**g) for g in result["gaps"]],
    )


@router.get("/state-events", response_model=StateEventsResponse)
async def get_state_events(
    router_sn: str = Query(...),
    equip_type: str = Query(...),
    panel_id: int = Query(...),
    addr: int = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    heartbeat_sec: int = Query(900, ge=10, le=86400,
                               description="Порог gap (сек). Gap = интервал > heartbeat × 2"),
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    """Журнал изменений состояния (discrete / enum регистры).

    Возвращает список событий с флагами gap_after/gap_duration_sec
    и список красных зон для отображения на графике.
    """
    enforce_router_scope(ctx, router_sn)
    result = await fetch_state_events(
        pool, router_sn, equip_type, panel_id, addr, start, end,
        heartbeat_sec=heartbeat_sec,
    )
    return StateEventsResponse(
        events=[StateEvent(**e) for e in result["events"]],
        gaps=[GapZone(**g) for g in result["gaps"]],
    )
