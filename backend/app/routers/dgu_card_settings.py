from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import AuthContext, require_auth
from app.config import get_config_dir

router = APIRouter(prefix="/api/dgu-card-settings", tags=["dgu-card-settings"])


class DguCardParam(BaseModel):
    addr: int
    label: str
    unit: str = ""
    decimals: int = 1


_DEFAULTS: list[dict[str, Any]] = [
    {"addr": 43019, "label": "Мощность уст.", "unit": "кВт", "decimals": 0},
    {"addr": 40034, "label": "Нагрузка",      "unit": "кВт", "decimals": 1},
    {"addr": 40070, "label": "Моточасы",      "unit": "ч",   "decimals": 0},
    {"addr": 40063, "label": "t масла",        "unit": "°C",  "decimals": 1},
    {"addr": 40062, "label": "P масла",        "unit": "кПа", "decimals": 0},
]


def _path():
    return get_config_dir() / "dgu_card_settings.json"


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


@router.get("", response_model=list[DguCardParam])
async def get_dgu_card_settings(ctx: AuthContext = Depends(require_auth)):
    """Список параметров для плашки ДГУ."""
    return _load()


@router.put("", response_model=list[DguCardParam])
async def save_dgu_card_settings(
    params: list[DguCardParam],
    ctx: AuthContext = Depends(require_auth),
):
    """Сохранить список параметров плашки ДГУ (только для администратора)."""
    if not params:
        raise HTTPException(status_code=422, detail="Список не может быть пустым")
    data = [p.model_dump() for p in params]
    _save(data)
    return data
