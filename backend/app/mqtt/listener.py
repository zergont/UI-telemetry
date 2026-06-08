# Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
# Программный комплекс «Честная Генерация»
# Модуль веб-дашборда и визуализации телеметрии
# Автор: Саввиди Александр Анатольевич | ИНН 4725009270
#
# Данное программное обеспечение является конфиденциальным.
# Несанкционированное копирование, распространение или использование
# без письменного разрешения правообладателя запрещено.

"""MQTT subscriber: decoded telemetry → TelemetryHub.

Sends raw register values (addr, value, raw) only — no metadata enrichment.
Register metadata is available via DB (register_catalog) and HTTP API.
"""
from __future__ import annotations

import asyncio
import json
import logging

import aiomqtt

from app.config import MqttConfig
from app.mqtt.hub import TelemetryHub

logger = logging.getLogger(__name__)


async def mqtt_listener(cfg: MqttConfig, hub: TelemetryHub) -> None:
    telemetry_topic = f"{cfg.topic_prefix}/+/pcc/+"
    reconnect_interval = cfg.reconnect_interval

    while True:
        try:
            async with aiomqtt.Client(
                hostname=cfg.host,
                port=cfg.port,
                username=cfg.user or None,
                password=cfg.password or None,
                identifier=cfg.client_id,
            ) as client:
                logger.info(
                    "MQTT connected to %s:%s, subscribing to %s",
                    cfg.host, cfg.port, telemetry_topic,
                )
                await client.subscribe(telemetry_topic)
                reconnect_interval = cfg.reconnect_interval

                async for message in client.messages:
                    topic_str = str(message.topic)
                    try:
                        payload = json.loads(message.payload)
                        await _handle_telemetry(topic_str, payload, hub)
                    except (json.JSONDecodeError, KeyError, TypeError) as exc:
                        logger.warning("Bad MQTT message on %s: %s", topic_str, exc)

        except aiomqtt.MqttError as exc:
            logger.error(
                "MQTT connection lost: %s — reconnecting in %ds", exc, reconnect_interval
            )
            await asyncio.sleep(reconnect_interval)
            reconnect_interval = min(reconnect_interval * 2, cfg.max_reconnect_interval)
        except asyncio.CancelledError:
            logger.info("MQTT listener cancelled")
            break
        except Exception as exc:
            logger.exception("Unexpected error in MQTT listener: %s", exc)
            await asyncio.sleep(reconnect_interval)


async def _handle_telemetry(
    topic_str: str,
    payload: dict,
    hub: TelemetryHub,
) -> None:
    router_sn: str = payload["router_sn"]
    bserver_id: int = payload.get("bserver_id", 0)

    # cg/v1/decoded/SN/<router_sn>/<equip_type>/<panel>
    topic_parts = topic_str.split("/")
    equip_type = topic_parts[5] if len(topic_parts) > 5 else "pcc"

    raw_registers: list[dict] = payload.get("registers", [])
    logger.debug(
        "Telemetry: router_sn=%s equip_type=%s regs=%d",
        router_sn, equip_type, len(raw_registers),
    )

    await hub.publish(router_sn, {
        "type": "telemetry",
        "router_sn": router_sn,
        "equip_type": equip_type,
        "panel_id": bserver_id,
        "timestamp": payload.get("timestamp"),
        "registers": [
            {"addr": r["addr"], "value": r.get("value"), "raw": r.get("raw")}
            for r in raw_registers
        ],
    })
