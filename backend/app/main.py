"""Честная Генерация — Dashboard Backend."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.db.migrate import run_migrations
from app.db.pool import close_pool, create_pool
from app.mqtt.hub import TelemetryHub
from app.mqtt.listener import mqtt_listener
from app.routers import equipment, events, history, objects, registers, share, system, ws
from app.services.nginx_check import log_nginx_status
from app.services.updater import get_current_version
from app.services.offline_tracker import offline_tracker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("Starting %s v%s", settings.app.name, settings.app.version)

    # 1. Run DB migrations (create cg_ui user, add equipment.name)
    try:
        await run_migrations(settings.database)
    except Exception as exc:
        logger.error("Migration failed: %s (continuing without migration)", exc)

    # 2. Create asyncpg pool (cg_ui credentials)
    try:
        pool = await create_pool(settings.database)
        app.state.db_pool = pool
        logger.info("Database pool created")
    except Exception as exc:
        logger.error("Database connection failed: %s", exc)
        app.state.db_pool = None

    # 3. Create telemetry hub
    hub = TelemetryHub()
    app.state.hub = hub

    # 4. Start MQTT listener
    mqtt_task = asyncio.create_task(mqtt_listener(settings.mqtt, hub))

    # 5. Start offline tracker
    offline_task = asyncio.create_task(
        offline_tracker(hub, settings.telemetry.offline_timeout_sec)
    )

    # 6. Check nginx availability
    log_nginx_status(settings.access.public_base_url)

    logger.info("Backend ready on %s:%s", settings.backend.host, settings.backend.port)
    yield

    # Cleanup
    mqtt_task.cancel()
    offline_task.cancel()
    if app.state.db_pool:
        await close_pool(app.state.db_pool)
    logger.info("Shutdown complete")


app = FastAPI(
    title="Честная Генерация",
    version="1.0.1",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(objects.router)
app.include_router(equipment.router)
app.include_router(registers.router)
app.include_router(history.router)
app.include_router(events.router)
app.include_router(share.router)
app.include_router(system.router)
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
