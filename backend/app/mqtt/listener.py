"""MQTT subscriber: decoded telemetry → TelemetryHub."""
from __future__ import annotations

import asyncio
import json
import logging

import aiomqtt

from app.config import MqttConfig
from app.mqtt.hub import TelemetryHub

logger = logging.getLogger(__name__)


async def mqtt_listener(cfg: MqttConfig, hub: TelemetryHub) -> None:
    topic = f"{cfg.topic_prefix}/+/pcc/+"
    reconnect_interval = cfg.reconnect_interval

    while True:
        try:
            async with aiomqtt.Client(
                hostname=cfg.host,
                port=cfg.port,
                identifier=cfg.client_id,
            ) as client:
                logger.info("MQTT connected to %s:%s, subscribing to %s", cfg.host, cfg.port, topic)
                await client.subscribe(topic)
                reconnect_interval = cfg.reconnect_interval

                async for message in client.messages:
                    try:
                        payload = json.loads(message.payload)
                        router_sn = payload["router_sn"]
                        bserver_id = payload.get("bserver_id", 0)

                        # Parse topic: cg/v1/decoded/SN/<router_sn>/<equip_type>/<panel>
                        # Индексы:     0  1  2       3   4            5             6
                        topic_parts = str(message.topic).split("/")
                        equip_type = topic_parts[5] if len(topic_parts) > 5 else "pcc"

                        ws_message = {
                            "type": "telemetry",
                            "router_sn": router_sn,
                            "equip_type": equip_type,
                            "panel_id": bserver_id,
                            "timestamp": payload.get("timestamp"),
                            "registers": payload.get("registers", []),
                        }
                        await hub.publish(router_sn, ws_message)
                    except (json.JSONDecodeError, KeyError, TypeError) as exc:
                        logger.warning("Bad MQTT message: %s", exc)

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
