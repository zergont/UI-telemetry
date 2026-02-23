from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class HistoryPoint(BaseModel):
    ts: Optional[datetime] = None
    value: Optional[float] = None
    text: Optional[str] = None
    reason: Optional[str] = None
