from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class EquipmentOut(BaseModel):
    router_sn: str
    equip_type: str
    panel_id: int
    name: Optional[str] = None
    first_seen_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    installed_power_kw: Optional[float] = None
    current_load_kw: Optional[float] = None
    engine_hours: Optional[float] = None
    oil_temp_c: Optional[float] = None
    oil_pressure_kpa: Optional[float] = None
    engine_state: str = "OFFLINE"
    connection_status: str = "OFFLINE"
    last_update: Optional[datetime] = None


class EquipmentNameUpdate(BaseModel):
    name: str
