from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ObjectOut(BaseModel):
    router_sn: str
    name: Optional[str] = None
    notes: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    equipment_count: int = 0
    status: str = "OFFLINE"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ObjectNameUpdate(BaseModel):
    name: str
