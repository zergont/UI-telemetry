from __future__ import annotations

from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel


class HistoryPoint(BaseModel):
    ts: Optional[datetime] = None
    value: Optional[float] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    text: Optional[str] = None
    reason: Optional[str] = None


class GapZone(BaseModel):
    """Диапазон потери данных (красная зона на графике)."""
    from_ts: datetime
    to_ts: datetime


class HistoryResponse(BaseModel):
    points: List[HistoryPoint]
    first_data_at: Optional[datetime] = None
    gaps: List[GapZone] = []
