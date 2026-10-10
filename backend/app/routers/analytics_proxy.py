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
прикрывая их собственной авторизацией (LAN / cookie / bearer) и областью
объектов зрителя: аналитика — те же данные телеметрии, что и уведомления,
и видна только по своим роутерам (enforce_router_scope).
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthContext, enforce_router_scope, require_auth
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
    """Текущее состояние машин: severity_level, status_text, coking_risk.

    Зритель с ограниченным списком объектов получает только свои машины.
    """
    machines = await _proxy_get("/api/machines")
    if ctx.allowed_router_sns is None:
        return machines
    if not isinstance(machines, list):
        return []
    return [m for m in machines
            if isinstance(m, dict) and str(m.get("router_sn")) in ctx.allowed_router_sns]


@router.get("/machine/{router_sn}/{equip_type}/{panel_id}/segments")
async def get_machine_segments(
    router_sn: str,
    equip_type: str,
    panel_id: int,
    year: int | None = None,
    month: int | None = None,
    limit: int = 200,
    ctx: AuthContext = Depends(require_auth),
):
    """История сегментов машины — для календаря аналитики."""
    enforce_router_scope(ctx, router_sn)
    query = f"?limit={limit}"
    if year and month:
        query += f"&year={year}&month={month}"
    return await _proxy_get(
        f"/api/machine/{router_sn}/{equip_type}/{panel_id}/segments{query}"
    )


@router.get("/segment/{seg_id}")
async def get_segment(seg_id: int, ctx: AuthContext = Depends(require_auth)):
    """Детальный отчёт по сегменту: отчёт, сводка, акт, разборы, заключение ИИ.

    Номер сегмента сквозной и перебирается, поэтому область объектов
    проверяется по роутеру из ответа: чужой сегмент — 403.
    """
    data = await _proxy_get(f"/api/segment/{seg_id}")
    if ctx.allowed_router_sns is not None:
        sn = data.get("router_sn") if isinstance(data, dict) else None
        enforce_router_scope(ctx, str(sn) if sn is not None else "")
    return data
