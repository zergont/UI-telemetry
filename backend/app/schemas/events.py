from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class EventOut(BaseModel):
    id: int
    router_sn: str
    equip_type: Optional[str] = None
    panel_id: Optional[int] = None
    type: str
    description: Optional[str] = None
    payload: Optional[dict[str, Any]] = None
    created_at: Optional[datetime] = None
