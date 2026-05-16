from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import AuthContext, require_auth
from app.config import get_config_dir

router = APIRouter(prefix="/api/chart-settings", tags=["chart-settings"])


class ChartRegister(BaseModel):
    addr: int
    label: str
    unit: str = ""
    color: str = "#22c55e"


_DEFAULTS: list[dict[str, Any]] = [
    {"addr": 40034, "label": "Нагрузка",   "unit": "кВт", "color": "#22c55e"},
    {"addr": 40035, "label": "Ток",         "unit": "А",   "color": "#3b82f6"},
    {"addr": 40038, "label": "Напряжение",  "unit": "В",   "color": "#f59e0b"},
    {"addr": 40063, "label": "t масла",     "unit": "°C",  "color": "#ef4444"},
    {"addr": 40062, "label": "P масла",     "unit": "кПа", "color": "#8b5cf6"},
    {"addr": 40070, "label": "Моточасы",   "unit": "с",   "color": "#06b6d4"},
]


def _path():
    return get_config_dir() / "chart_settings.json"


def _load() -> list[dict[str, Any]]:
    p = _path()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return _DEFAULTS


def _save(data: list[dict[str, Any]]) -> None:
    _path().write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@router.get("", response_model=list[ChartRegister])
async def get_chart_settings(ctx: AuthContext = Depends(require_auth)):
    """Список регистров для вкладки График."""
    return _load()


@router.put("", response_model=list[ChartRegister])
async def save_chart_settings(
    registers: list[ChartRegister],
    ctx: AuthContext = Depends(require_auth),
):
    """Сохранить новый список регистров (только для администратора)."""
    if not registers:
        raise HTTPException(status_code=422, detail="Список не может быть пустым")
    data = [r.model_dump() for r in registers]
    _save(data)
    return data
