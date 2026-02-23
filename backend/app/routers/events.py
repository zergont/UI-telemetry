from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.auth import verify_token
from app.db.queries.events import fetch_events
from app.deps import get_pool
from app.schemas.events import EventOut

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("/", response_model=list[EventOut])
async def get_events(
    router_sn: str | None = Query(None),
    equip_type: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, le=500),
    pool: asyncpg.Pool = Depends(get_pool),
    _: str = Depends(verify_token),
):
    rows = await fetch_events(pool, router_sn, equip_type, offset, limit)
    return [EventOut(**r) for r in rows]
