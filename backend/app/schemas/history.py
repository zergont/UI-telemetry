from __future__ import annotations

from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel


class HistoryPoint(BaseModel):
    ts: Optional[datetime] = None
    value: Optional[float] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    open_value: Optional[float] = None   # OHLC: первое значение в бакете
    close_value: Optional[float] = None  # OHLC: последнее значение в бакете
    sample_count: Optional[int] = None   # None = gapfilled бакет (нет данных)
    synthetic: Optional[bool] = None     # deprecated (v3.0: не используется)
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


# ── State events (дискретные / enum регистры) ────────────────────────────────

class StateEvent(BaseModel):
    ts: datetime
    raw: Optional[int] = None
    text: Optional[str] = None
    write_reason: Optional[str] = None   # 'change' | 'heartbeat'
    gap_after: bool = False              # True = после этой записи разрыв данных
    gap_duration_sec: Optional[int] = None


class StateEventsResponse(BaseModel):
    events: List[StateEvent]
    gaps: List[GapZone] = []
