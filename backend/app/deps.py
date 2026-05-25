from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Request

if TYPE_CHECKING:
    import asyncpg

    from app.mqtt.hub import TelemetryHub
    from app.mqtt.map_store import MapStore


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db_pool


def get_hub(request: Request) -> TelemetryHub:
    return request.app.state.hub


def get_map_store(request: Request) -> MapStore:
    return request.app.state.map_store
