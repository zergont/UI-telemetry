"""Background task: detect MQTT silence and emit OFFLINE status events.

Шлёт OFFLINE только при переходе (ONLINE → OFFLINE), а не каждые 30 секунд.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.mqtt.hub import TelemetryHub

logger = logging.getLogger(__name__)

# Храним последний отправленный статус по ключу оборудования
_emitted_offline: set[tuple[str, str, int]] = set()


async def offline_tracker(hub: TelemetryHub, timeout_sec: int) -> None:
    while True:
        await asyncio.sleep(30)
        now = datetime.now(timezone.utc)

        for (router_sn, equip_type, panel_id), last_ts in hub.last_seen.items():
            key = (router_sn, equip_type, panel_id)

            if last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=timezone.utc)

            age = (now - last_ts).total_seconds()

            if age > timeout_sec:
                # Шлём OFFLINE только если ещё не отправляли
                if key not in _emitted_offline:
                    _emitted_offline.add(key)
                    await hub.publish(router_sn, {
                        "type": "status_change",
                        "router_sn": router_sn,
                        "equip_type": equip_type,
                        "panel_id": panel_id,
                        "status": "OFFLINE",
                    })
                    logger.info(
                        "OFFLINE: %s/%s/%s (молчит %ds)",
                        router_sn, equip_type, panel_id, int(age),
                    )
            else:
                # Оборудование снова на связи — сбрасываем флаг
                _emitted_offline.discard(key)
