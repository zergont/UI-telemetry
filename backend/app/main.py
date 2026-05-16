"""Честная Генерация — Dashboard Backend."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import APP_VERSION, get_settings
from app.db.pool import close_pool, create_pool
from app.mqtt.hub import TelemetryHub
from app.mqtt.listener import mqtt_listener
from app.routers import admin_proxy, chart_settings, equipment, events, history, notifications, objects, registers, share, system, tiles, ws
from app.services.nginx_check import log_nginx_status
from app.services.updater import get_current_version
from app.services.offline_tracker import offline_tracker
from app.services.tile_cache import prefetch_for_objects
from app.db.queries.objects import fetch_all_objects

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("Starting %s v%s", settings.app.name, settings.app.version)

    # 1. Create asyncpg pool (cg_ui credentials)
    try:
        pool = await create_pool(settings.database)
        app.state.db_pool = pool
        logger.info("Database pool created")
    except Exception as exc:
        logger.error("Database connection failed: %s", exc)
        app.state.db_pool = None

    # 2. Create telemetry hub
    hub = TelemetryHub()
    app.state.hub = hub

    # 3. Start MQTT listener
    mqtt_task = asyncio.create_task(mqtt_listener(settings.mqtt, hub))

    # 4. Start offline tracker
    offline_task = asyncio.create_task(
        offline_tracker(hub, settings.telemetry.offline_timeout_sec)
    )

    # 5. Check nginx availability
    log_nginx_status(settings.access.public_base_url)

    # 6. Background tile prefetch for existing objects
    async def _prefetch_tiles():
        await asyncio.sleep(10)  # дать БД прогреться
        if app.state.db_pool:
            try:
                objs = await fetch_all_objects(app.state.db_pool)
                await prefetch_for_objects(objs)
            except Exception as exc:
                logger.warning("Tile prefetch failed: %s", exc)

    prefetch_task = asyncio.create_task(_prefetch_tiles())

    logger.info("Backend ready on %s:%s", settings.backend.host, settings.backend.port)
    yield

    # Cleanup
    mqtt_task.cancel()
    offline_task.cancel()
    prefetch_task.cancel()
    if app.state.db_pool:
        await close_pool(app.state.db_pool)
    logger.info("Shutdown complete")


app = FastAPI(
    title="Честная Генерация",
    version=APP_VERSION,
    lifespan=lifespan,
)

# CORS — ограничиваем origins доменом из конфига
_settings = get_settings()
_cors_origins = _settings.access.cors_origins
if not _cors_origins:
    # Автоматически из public_base_url (например https://cg.ngenergoservice.ru)
    _cors_origins = [_settings.access.public_base_url.rstrip("/")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(objects.router)
app.include_router(equipment.router)
app.include_router(registers.router)
app.include_router(history.router)
app.include_router(notifications.router)
app.include_router(admin_proxy.router)
app.include_router(chart_settings.router)
app.include_router(events.router)
app.include_router(share.router)
app.include_router(system.router)
app.include_router(tiles.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/config")
async def frontend_config():
    """Return frontend-safe config subset (no secrets)."""
    settings = get_settings()
    ver = get_current_version(settings.app.version)
    return {
        "app": {"name": settings.app.name, "version": ver["version"], "commit": ver["commit"]},
        "ws_url": settings.frontend.ws_url,
        "map": settings.frontend.map.model_dump(),
        "key_registers": settings.telemetry.key_registers.model_dump(),
    }
