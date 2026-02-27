"""Роутеры для share-ссылок.

GET  /view/{token}       — вход по ссылке → cookie → 302 redirect
POST /api/share-links    — создать ссылку (admin)
GET  /api/share-links    — список ссылок (admin)
POST /api/share-links/{id}/revoke — отозвать (admin)
GET  /api/me             — текущий пользователь (роль, scope)
"""
from __future__ import annotations

from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth import COOKIE_NAME, AuthContext, require_admin, require_auth
from app.config import Settings, get_settings
from app.deps import get_pool
from app.services.access_log import log_access
from app.services.rate_limiter import view_limiter
from app.services.share_links import (
    create_session_cookie,
    create_share_link,
    list_links,
    revoke_link,
    validate_token,
)

router = APIRouter(tags=["share"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ShareLinkCreate(BaseModel):
    label: str = ""
    scope_type: str = "all"
    scope_id: str | None = None
    max_uses: int | None = None
    expire_days: int = 7


class ShareLinkOut(BaseModel):
    id: int
    label: str
    scope_type: str
    scope_id: str | None
    role: str
    max_uses: int | None
    use_count: int
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None
    created_by: str
    token: str | None = None  # Только при создании
    url: str | None = None     # Полная ссылка — только при создании


class MeOut(BaseModel):
    role: str
    method: str
    scope_type: str
    scope_id: str | None


# ---------------------------------------------------------------------------
# GET /view/{token} — вход по share-ссылке
# ---------------------------------------------------------------------------

@router.get("/view/{token}")
async def view_entry(
    token: str,
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
):
    client_ip = request.client.host if request.client else "0.0.0.0"

    # Rate limiting
    if not view_limiter.is_allowed(client_ip):
        log_access(
            action="view_entry", role="anonymous", scope="",
            client_ip=client_ip, result="rate_limited",
        )
        raise HTTPException(status_code=429, detail="Too many requests")

    # Валидируем токен
    link = await validate_token(pool, token)
    if not link:
        log_access(
            action="view_entry", role="anonymous", scope="",
            client_ip=client_ip, result="denied", detail="invalid_token",
        )
        raise HTTPException(status_code=403, detail="Link is invalid, expired, or revoked")

    # Создаём signed cookie
    cookie_value = create_session_cookie(
        secret=settings.access.session_secret,
        link_id=link["id"],
        role=link["role"],
        scope_type=link["scope_type"],
        scope_id=link.get("scope_id"),
    )

    # Определяем redirect URL
    scope_type = link["scope_type"]
    scope_id = link.get("scope_id")
    if scope_type == "site" and scope_id:
        redirect_path = f"/objects/{scope_id}"
    else:
        redirect_path = "/"

    log_access(
        action="view_entry", role=link["role"],
        scope=f"{scope_type}:{scope_id or '*'}",
        client_ip=client_ip, result="ok",
        detail=f"link_id={link['id']}",
    )

    response = RedirectResponse(url=redirect_path, status_code=302)
    response.set_cookie(
        key=COOKIE_NAME,
        value=cookie_value,
        max_age=settings.access.session_max_age_sec,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    return response


# ---------------------------------------------------------------------------
# GET /api/me — текущий пользователь
# ---------------------------------------------------------------------------

@router.get("/api/me", response_model=MeOut)
async def get_me(ctx: AuthContext = Depends(require_auth)):
    return MeOut(
        role=ctx.role,
        method=ctx.method,
        scope_type=ctx.scope_type,
        scope_id=ctx.scope_id,
    )


# ---------------------------------------------------------------------------
# Admin CRUD для share-ссылок
# ---------------------------------------------------------------------------

@router.post("/api/share-links", response_model=ShareLinkOut)
async def create_link(
    body: ShareLinkCreate,
    pool: asyncpg.Pool = Depends(get_pool),
    settings: Settings = Depends(get_settings),
    ctx: AuthContext = Depends(require_admin),
):
    link = await create_share_link(
        pool,
        label=body.label,
        scope_type=body.scope_type,
        scope_id=body.scope_id,
        role="viewer",  # Всегда viewer для share-ссылок
        max_uses=body.max_uses,
        expire_days=body.expire_days,
    )

    # Формируем полную URL
    base_url = settings.access.public_base_url.rstrip("/")
    link["url"] = f"{base_url}/view/{link['token']}"

    log_access(
        action="create_share_link", role="admin",
        scope=f"{body.scope_type}:{body.scope_id or '*'}",
        client_ip=ctx.client_ip, result="ok",
        detail=f"link_id={link['id']} label={body.label}",
    )

    return ShareLinkOut(**link)


@router.get("/api/share-links", response_model=list[ShareLinkOut])
async def get_links(
    pool: asyncpg.Pool = Depends(get_pool),
    _: AuthContext = Depends(require_admin),
):
    rows = await list_links(pool)
    return [ShareLinkOut(**r) for r in rows]


@router.post("/api/share-links/{link_id}/revoke")
async def revoke(
    link_id: int,
    pool: asyncpg.Pool = Depends(get_pool),
    ctx: AuthContext = Depends(require_admin),
):
    ok = await revoke_link(pool, link_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Link not found or already revoked")

    log_access(
        action="revoke_share_link", role="admin",
        client_ip=ctx.client_ip, result="ok",
        detail=f"link_id={link_id}",
    )
    return {"ok": True}
