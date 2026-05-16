from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthContext, require_auth
from app.config import get_settings

router = APIRouter(prefix="/api/admin", tags=["admin-proxy"])

_TIMEOUT = 10.0


def _admin_url(path: str) -> str:
    base = get_settings().cg_admin.url.rstrip("/")
    return f"{base}{path}"


@router.get("/version")
async def get_admin_version(ctx: AuthContext = Depends(require_auth)):
    """Текущая версия cg-admin (GET, без токена — LAN auto-admin)."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(_admin_url("/admin/api/system/version"), timeout=_TIMEOUT)
            r.raise_for_status()
            return r.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="cg-admin недоступен")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)


@router.post("/update")
async def trigger_admin_update(ctx: AuthContext = Depends(require_auth)):
    """Запустить обновление cg-admin (POST, требует Bearer токен)."""
    settings = get_settings()
    if not settings.cg_admin.token:
        raise HTTPException(status_code=503, detail="cg_admin.token не задан в config.yaml")
    headers = {"Authorization": f"Bearer {settings.cg_admin.token}"}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                _admin_url("/admin/api/system/update"),
                headers=headers,
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            return r.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="cg-admin недоступен")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)


@router.get("/check-update")
async def check_admin_update(ctx: AuthContext = Depends(require_auth)):
    """Сравнить текущую версию cg-admin с последним релизом на GitHub."""
    settings = get_settings()

    # 1. Текущая версия cg-admin
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(_admin_url("/admin/api/system/version"), timeout=_TIMEOUT)
            r.raise_for_status()
            current = r.json()
    except Exception:
        raise HTTPException(status_code=503, detail="cg-admin недоступен")

    current_tag: str = current.get("git_tag", "")

    # 2. Последний релиз на GitHub
    repo = settings.cg_admin.github_repo
    gh_headers = {"Accept": "application/vnd.github.v3+json", "X-GitHub-Api-Version": "2022-11-28"}
    latest_tag: str | None = None
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://api.github.com/repos/{repo}/releases/latest",
                headers=gh_headers,
                timeout=_TIMEOUT,
            )
            if r.status_code == 200:
                latest_tag = r.json().get("tag_name")
            else:
                # Нет releases — смотрим теги
                r2 = await client.get(
                    f"https://api.github.com/repos/{repo}/tags",
                    headers=gh_headers,
                    timeout=_TIMEOUT,
                )
                r2.raise_for_status()
                tags = r2.json()
                latest_tag = tags[0]["name"] if tags else None
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="GitHub недоступен")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)

    return {
        "current": current_tag,
        "latest": latest_tag,
        "has_update": bool(latest_tag and latest_tag != current_tag),
        "commit": current.get("commit", ""),
    }


@router.get("/update-status")
async def get_admin_update_status(ctx: AuthContext = Depends(require_auth)):
    """Статус хода обновления cg-admin (GET, без токена — LAN auto-admin)."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                _admin_url("/admin/api/updates/cg-admin/status"),
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            return r.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="cg-admin недоступен")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
