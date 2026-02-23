"""Background task: detect MQTT silence and emit OFFLINE status events."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.mqtt.hub import TelemetryHub

logger = logging.getLogger(__name__)


async def offline_tracker(hub: TelemetryHub, timeout_sec: int) -> None:
    while True:
        await asyncio.sleep(30)
        now = datetime.now(timezone.utc)
        stale_keys: list[tuple[str, str, int]] = []

        for (router_sn, equip_type, panel_id), last_ts in hub.last_seen.items():
            if last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=timezone.utc)
            age = (now - last_ts).total_seconds()
            if age > timeout_sec:
                stale_keys.append((router_sn, equip_type, panel_id))

        for router_sn, equip_type, panel_id in stale_keys:
            await hub.publish(router_sn, {
                "type": "status_change",
                "router_sn": router_sn,
                "equip_type": equip_type,
                "panel_id": panel_id,
                "status": "OFFLINE",
            })
