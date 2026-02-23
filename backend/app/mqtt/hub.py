"""In-memory pub/sub: MQTT messages → WebSocket fan-out."""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class TelemetryHub:
    def __init__(self) -> None:
        # router_sn → set of asyncio.Queue (per WS client)
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
        # Global subscribers (start page — receive everything)
        self._global: set[asyncio.Queue] = set()
        # (router_sn, equip_type, panel_id) → last message timestamp
        self.last_seen: dict[tuple[str, str, int], datetime] = {}
        # In-memory cache: (router_sn, equip_type, panel_id) → last full message
        self.cache: dict[tuple[str, str, int], dict] = {}

    def subscribe(self, router_sn: str | None = None) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        if router_sn is None:
            self._global.add(queue)
        else:
            self._subscribers[router_sn].add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue, router_sn: str | None = None) -> None:
        if router_sn is None:
            self._global.discard(queue)
        else:
            self._subscribers[router_sn].discard(queue)

    async def publish(self, router_sn: str, message: dict) -> None:
        equip_type = message.get("equip_type", "")
        panel_id = message.get("panel_id", 0)
        if isinstance(panel_id, str):
            panel_id = int(panel_id) if panel_id.isdigit() else 0

        key = (router_sn, equip_type, panel_id)
        self.last_seen[key] = datetime.now(timezone.utc)
        self.cache[key] = message

        targets = list(self._subscribers.get(router_sn, set())) + list(self._global)
        for queue in targets:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # Drop message — client too slow
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(message)
                except asyncio.QueueFull:
                    pass
