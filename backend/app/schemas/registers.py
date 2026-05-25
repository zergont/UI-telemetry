from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class FaultItem(BaseModel):
    bit: int
    name: str
    severity: str  # warning / derate / shutdown / shutdown_cooldown / none / unknown


class RegisterOut(BaseModel):
    addr: int
    name: Optional[str] = None
    name_en: Optional[str] = None
    value: Optional[float] = None
    raw: Optional[int] = None
    text: Optional[str] = None
    unit: Optional[str] = None
    reason: Optional[str] = None
    ts: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    notes_ru: Optional[str] = None
    faults: Optional[list[FaultItem]] = None
