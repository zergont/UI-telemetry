# Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
# Программный комплекс «Честная Генерация»
# Модуль веб-дашборда и визуализации телеметрии
# Автор: Саввиди Александр Анатольевич | ИНН 4725009270
#
# Данное программное обеспечение является конфиденциальным.
# Несанкционированное копирование, распространение или использование
# без письменного разрешения правообладателя запрещено.

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
    """Сравнить текущий commit cg-admin с HEAD ветки по умолчанию на GitHub.

    Git-теги в репозитории cg-admin не сопровождают каждый релиз (версия бампается
    в коде на каждый пуш), поэтому сравнение по тегам/releases даёт ложные
    результаты — сравниваем по коммитам через GitHub compare API.
    """
    settings = get_settings()

    # 1. Текущая версия + commit cg-admin
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(_admin_url("/admin/api/system/version"), timeout=_TIMEOUT)
            r.raise_for_status()
            current = r.json()
    except Exception:
        raise HTTPException(status_code=503, detail="cg-admin недоступен")

    current_ver: str = current.get("version", "")
    current_commit: str = current.get("commit", "")
    if not current_commit:
        raise HTTPException(status_code=503, detail="cg-admin не вернул commit")

    # 2. HEAD ветки по умолчанию и разница в коммитах на GitHub
    repo = settings.cg_admin.github_repo
    gh_headers = {"Accept": "application/vnd.github.v3+json", "X-GitHub-Api-Version": "2022-11-28"}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"https://api.github.com/repos/{repo}", headers=gh_headers, timeout=_TIMEOUT)
            r.raise_for_status()
            default_branch = r.json().get("default_branch", "main")

            r2 = await client.get(
                f"https://api.github.com/repos/{repo}/compare/{current_commit}...{default_branch}",
                headers=gh_headers,
                timeout=_TIMEOUT,
            )
            r2.raise_for_status()
            cmp = r2.json()
    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(status_code=503, detail="GitHub недоступен")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)

    ahead_by: int = cmp.get("ahead_by", 0)
    commits = cmp.get("commits") or []
    latest_commit = commits[-1]["sha"][:7] if commits else current_commit

    return {
        "current": current_ver,
        "commit": current_commit,
        "ahead_by": ahead_by,
        "latest_commit": latest_commit,
        "has_update": ahead_by > 0,
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
