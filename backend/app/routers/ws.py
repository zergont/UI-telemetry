from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.auth import COOKIE_NAME, get_ws_auth_context
from app.config import get_settings
from app.mqtt.hub import TelemetryHub
from app.services.access_log import log_access

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(""),
    subscribe: str | None = Query(None),
):
    settings = get_settings()

    # Аутентификация: IP → cookie → bearer (query param)
    cookie_value = websocket.cookies.get(COOKIE_NAME, "")
    ctx = await get_ws_auth_context(websocket, settings, token=token, cookie_value=cookie_value)

    if not ctx.is_authenticated:
        log_access(
            action="ws_connect", role="anonymous",
            client_ip=ctx.client_ip, result="denied",
        )
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()
    hub: TelemetryHub = websocket.app.state.hub

    # Scope: если viewer с ограниченным scope — подписываем только на его объект
    effective_subscribe = subscribe
    if ctx.allowed_router_sns is not None:
        if subscribe is None:
            # Viewer с scope=site подписывается только на свой объект
            if len(ctx.allowed_router_sns) == 1:
                effective_subscribe = next(iter(ctx.allowed_router_sns))
        elif subscribe not in ctx.allowed_router_sns:
            # Пытается подписаться на чужой объект
            log_access(
                action="ws_connect", role=ctx.role,
                scope=f"subscribe={subscribe}",
                client_ip=ctx.client_ip, result="denied",
                detail="scope_violation",
            )
            await websocket.close(code=4003, reason="Access denied to this object")
            return

    queue = hub.subscribe(router_sn=effective_subscribe)
    log_access(
        action="ws_connect", role=ctx.role,
        scope=f"subscribe={effective_subscribe}",
        client_ip=ctx.client_ip, result="ok",
        detail=f"method={ctx.method}",
    )

    try:
        # Сразу отправляем snapshot из кэша — клиент не ждёт новый MQTT пакет
        snapshot = hub.get_snapshot(router_sn=effective_subscribe)

        # Scope filtering для snapshot (global subscribe)
        if ctx.allowed_router_sns is not None and effective_subscribe is None:
            snapshot = [
                msg for msg in snapshot
                if msg.get("router_sn") in ctx.allowed_router_sns
            ]

        if snapshot:
            await websocket.send_json({
                "type": "snapshot",
                "items": snapshot,
            })

        send_task = asyncio.create_task(
            _ws_sender(websocket, queue, ctx.allowed_router_sns)
        )
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
        hub.unsubscribe(queue, router_sn=effective_subscribe)
        logger.info("WS disconnected, role=%s subscribe=%s", ctx.role, effective_subscribe)


async def _ws_sender(
    websocket: WebSocket,
    queue: asyncio.Queue,
    allowed_sns: set[str] | None,
) -> None:
    """Отправляет сообщения клиенту с фильтрацией по scope."""
    while True:
        message = await queue.get()
        # Фильтрация: если у клиента ограниченный scope
        if allowed_sns is not None:
            msg_sn = message.get("router_sn")
            if msg_sn and msg_sn not in allowed_sns:
                continue
        await websocket.send_json(message)


async def _ws_receiver(websocket: WebSocket) -> None:
    while True:
        await websocket.receive_text()
