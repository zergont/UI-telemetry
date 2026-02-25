from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.mqtt.hub import TelemetryHub

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(""),
    subscribe: str | None = Query(None),
):
    settings = get_settings()
    if token != settings.auth.token:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()
    hub: TelemetryHub = websocket.app.state.hub

    queue = hub.subscribe(router_sn=subscribe)
    logger.info("WS client connected, subscribe=%s", subscribe)

    try:
        # Сразу отправляем snapshot из кэша — клиент не ждёт новый MQTT пакет
        snapshot = hub.get_snapshot(router_sn=subscribe)
        if snapshot:
            await websocket.send_json({
                "type": "snapshot",
                "items": snapshot,
            })
            logger.info(
                "WS snapshot sent: %d items (subscribe=%s)",
                len(snapshot), subscribe,
            )

        send_task = asyncio.create_task(_ws_sender(websocket, queue))
        recv_task = asyncio.create_task(_ws_receiver(websocket))
        done, pending = await asyncio.wait(
            {send_task, recv_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WS error: %s", exc)
    finally:
        hub.unsubscribe(queue, router_sn=subscribe)
        logger.info("WS client disconnected, subscribe=%s", subscribe)


async def _ws_sender(websocket: WebSocket, queue: asyncio.Queue) -> None:
    while True:
        message = await queue.get()
        await websocket.send_json(message)


async def _ws_receiver(websocket: WebSocket) -> None:
    while True:
        await websocket.receive_text()
