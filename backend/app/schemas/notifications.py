from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class NotificationOut(BaseModel):
    addr: int
    bit: int
    fault_name: Optional[str] = None         # English (из карты декодера)
    fault_description: Optional[str] = None  # Русское описание
    severity: Optional[str] = None           # 'shutdown' | 'warning' | 'unknown'
    fault_start: datetime
    fault_end: Optional[datetime] = None     # None = активна прямо сейчас
    duration_seconds: Optional[int] = None
