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
    text: Optional[str] = None
    reason: Optional[str] = None


class GapZone(BaseModel):
    gap_start: datetime
    gap_end: Optional[datetime] = None  # None = ongoing (оборудование offline)


class HistoryResponse(BaseModel):
    points: List[HistoryPoint]
    first_data_at: Optional[datetime] = None
    gaps: List[GapZone] = []


# ── Journal (все state_events оборудования) ──────────────────────────────────

class JournalEvent(BaseModel):
    ts: datetime
    addr: int
    name: Optional[str] = None
    raw: Optional[int] = None
    text: Optional[str] = None
    write_reason: Optional[str] = None


class JournalResponse(BaseModel):
    events: List[JournalEvent]


# ── State events (дискретные / enum регистры) ────────────────────────────────

class StateEvent(BaseModel):
    ts: datetime
    raw: Optional[int] = None
    text: Optional[str] = None
    write_reason: Optional[str] = None   # 'change' | 'heartbeat'


class StateEventsResponse(BaseModel):
    events: List[StateEvent]
