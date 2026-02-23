from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class RegisterOut(BaseModel):
    addr: int
    name: Optional[str] = None
    value: Optional[float] = None
    raw: Optional[int] = None
    text: Optional[str] = None
    unit: Optional[str] = None
    reason: Optional[str] = None
    ts: Optional[datetime] = None
    updated_at: Optional[datetime] = None
