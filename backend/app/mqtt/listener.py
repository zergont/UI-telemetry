"""MQTT subscriber: decoded telemetry + device maps → TelemetryHub."""
from __future__ import annotations

import asyncio
import json
import logging

import aiomqtt

from app.config import MqttConfig
from app.mqtt.hub import TelemetryHub
from app.mqtt.map_store import MapStore
from app.services.enrichment import enrich_register

logger = logging.getLogger(__name__)


def _handle_map(payload: dict, map_store: MapStore) -> None:
    """Обновить MapStore из retained map-сообщения."""
    device_type = payload.get("device_type")
    registers = payload.get("registers")
    if device_type and isinstance(registers, dict):
        map_store.update(device_type, registers)
    else:
        logger.warning(
            "Map message missing device_type or registers. Keys: %s",
            list(payload.keys()),
        )


async def _handle_telemetry(
    topic_str: str,
    payload: dict,
    hub: TelemetryHub,
    map_store: MapStore,
) -> None:
    """Обогатить регистры из map и опубликовать в TelemetryHub."""
    router_sn = payload["router_sn"]
    bserver_id = payload.get("bserver_id", 0)

    # cg/v1/decoded/SN/<router_sn>/<equip_type>/<panel>
    # Индексы:        0  1  2       3   4            5             6
    topic_parts = topic_str.split("/")
    equip_type = topic_parts[5] if len(topic_parts) > 5 else "pcc"

    raw_registers: list[dict] = payload.get("registers", [])
    map_ready = map_store.has(equip_type)
    logger.debug(
        "Telemetry: router_sn=%s equip_type=%s regs=%d map_ready=%s",
        router_sn, equip_type, len(raw_registers), map_ready,
    )
    enriched = []
    for r in raw_registers:
        addr = r["addr"]
        meta = enrich_register(equip_type, addr, r.get("value"), r.get("raw"), map_store)
        enriched.append(meta)

    ws_message = {
        "type": "telemetry",
        "router_sn": router_sn,
        "equip_type": equip_type,
        "panel_id": bserver_id,
        "timestamp": payload.get("timestamp"),
        "registers": enriched,
    }
    await hub.publish(router_sn, ws_message)


async def mqtt_listener(cfg: MqttConfig, hub: TelemetryHub, map_store: MapStore) -> None:
    telemetry_topic = f"{cfg.topic_prefix}/+/pcc/+"
    map_topic = f"{cfg.map_topic_prefix}/+"
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
                    "MQTT connected to %s:%s, subscribing to %s and %s",
                    cfg.host, cfg.port, telemetry_topic, map_topic,
                )
                await client.subscribe(telemetry_topic)
                await client.subscribe(map_topic)
                reconnect_interval = cfg.reconnect_interval

                async for message in client.messages:
                    topic_str = str(message.topic)
                    try:
                        payload = json.loads(message.payload)
                        if topic_str.startswith(cfg.map_topic_prefix + "/"):
                            # Топик вида cg/v1/maps/<device_type>
                            _handle_map(payload, map_store)
                        else:
                            await _handle_telemetry(topic_str, payload, hub, map_store)
                    except (json.JSONDecodeError, KeyError, TypeError) as exc:
                        logger.warning("Bad MQTT message on %s: %s", topic_str, exc)

        except aiomqtt.MqttError as exc:
            logger.error("MQTT connection lost: %s — reconnecting in %ds", exc, reconnect_interval)
            await asyncio.sleep(reconnect_interval)
            reconnect_interval = min(reconnect_interval * 2, cfg.max_reconnect_interval)
        except asyncio.CancelledError:
            logger.info("MQTT listener cancelled")
            break
        except Exception as exc:
            logger.exception("Unexpected error in MQTT listener: %s", exc)
            await asyncio.sleep(reconnect_interval)
