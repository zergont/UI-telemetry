from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth import AuthContext, enforce_router_scope, require_auth
from app.db.queries.events import fetch_events
from app.deps import get_pool
from app.schemas.events import EventOut

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=list[EventOut])
async def get_events(
    router_sn: str | None = Query(None),
    equip_type: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, le=500),
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_auth),
):
    # Scope enforcement для viewer с ограниченным доступом
    if ctx.allowed_router_sns is not None:
        if router_sn:
            enforce_router_scope(ctx, router_sn)
        else:
            # Viewer без router_sn — подставляем единственный разрешённый
            if len(ctx.allowed_router_sns) == 1:
                router_sn = next(iter(ctx.allowed_router_sns))
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="router_sn is required for scoped viewer",
                )

    rows = await fetch_events(pool, router_sn, equip_type, offset, limit)
    return [EventOut(**r) for r in rows]
