from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class WsMessage(BaseModel):
    type: str
    router_sn: Optional[str] = None
    data: Optional[dict[str, Any]] = None
