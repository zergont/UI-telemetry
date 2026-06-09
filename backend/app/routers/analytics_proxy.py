# Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
# Программный комплекс «Честная Генерация»
# Модуль веб-дашборда и визуализации телеметрии
# Автор: Саввиди Александр Анатольевич | ИНН 4725009270
#
# Данное программное обеспечение является конфиденциальным.
# Несанкционированное копирование, распространение или использование
# без письменного разрешения правообладателя запрещено.

"""Прокси к cg-analytics: ИИ-аналитика состояния машин.

cg-analytics работает во внутренней сети без авторизации, поэтому
наружу его API не публикуем — дашборд проксирует запросы через себя,
прикрывая их собственной авторизацией (LAN / cookie / bearer).
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthContext, require_auth
from app.config import get_settings

router = APIRouter(prefix="/api/analytics", tags=["analytics-proxy"])

_TIMEOUT = 5.0


def _analytics_url(path: str) -> str:
    base = get_settings().cg_analytics.url.rstrip("/")
    return f"{base}{path}"


async def _proxy_get(path: str):
    settings = get_settings()
    if not settings.cg_analytics.enabled:
        raise HTTPException(status_code=503, detail="cg-analytics отключён в config.yaml")
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(_analytics_url(path), timeout=_TIMEOUT)
            r.raise_for_status()
            return r.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="cg-analytics не отвечает")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="cg-analytics недоступен")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)


@router.get("/machines")
async def get_machines(ctx: AuthContext = Depends(require_auth)):
    """Текущее состояние машин: severity_level, status_text, coking_risk."""
    return await _proxy_get("/api/machines")
