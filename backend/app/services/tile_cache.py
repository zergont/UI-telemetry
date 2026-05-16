"""OSM tile proxy with disk cache and background prefetch."""
from __future__ import annotations

import asyncio
import logging
import math
from pathlib import Path

import httpx

from app.config import get_config_dir

logger = logging.getLogger(__name__)

TILE_CACHE_DIR = get_config_dir() / "tile_cache"
OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
MAX_ZOOM = 14
PREFETCH_RADIUS_KM = 20
# OSM usage policy: max ~1 req/s for bulk downloads
PREFETCH_DELAY = 1.1


def _tile_path(z: int, x: int, y: int) -> Path:
    return TILE_CACHE_DIR / str(z) / str(x) / f"{y}.png"


def get_cached_tile(z: int, x: int, y: int) -> bytes | None:
    p = _tile_path(z, x, y)
    if p.exists():
        return p.read_bytes()
    return None


def save_tile(z: int, x: int, y: int, data: bytes) -> None:
    p = _tile_path(z, x, y)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


async def fetch_tile(client: httpx.AsyncClient, z: int, x: int, y: int) -> bytes | None:
    url = OSM_TILE_URL.format(z=z, x=x, y=y)
    try:
        resp = await client.get(url)
        if resp.status_code == 200:
            return resp.content
        logger.warning("OSM tile %s/%s/%s returned %s", z, x, y, resp.status_code)
    except httpx.HTTPError as exc:
        logger.warning("OSM tile fetch error %s/%s/%s: %s", z, x, y, exc)
    return None


async def get_or_fetch_tile(z: int, x: int, y: int) -> bytes | None:
    cached = get_cached_tile(z, x, y)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(
        headers={"User-Agent": "CG-Dashboard/1.0"},
        timeout=10,
    ) as client:
        data = await fetch_tile(client, z, x, y)
    if data:
        save_tile(z, x, y, data)
    return data


# ---------------------------------------------------------------------------
# Prefetch: download tiles around a coordinate
# ---------------------------------------------------------------------------

def _deg2tile(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    """Convert lat/lon to tile x/y at given zoom."""
    lat_rad = math.radians(lat)
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def _tiles_in_radius(lat: float, lon: float, radius_km: float, zoom: int) -> list[tuple[int, int]]:
    """List all tile (x, y) within radius_km of (lat, lon) at given zoom."""
    # Approximate offset in degrees
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * math.cos(math.radians(lat)))

    x_min, y_max = _deg2tile(lat - dlat, lon - dlon, zoom)
    x_max, y_min = _deg2tile(lat + dlat, lon + dlon, zoom)

    n = 2 ** zoom
    tiles = []
    for x in range(max(0, x_min), min(n, x_max + 1)):
        for y in range(max(0, y_min), min(n, y_max + 1)):
            tiles.append((x, y))
    return tiles


# Track which (lat, lon) regions have been prefetched to avoid duplicates
_prefetched: set[tuple[float, float]] = set()


def _round_coord(lat: float, lon: float) -> tuple[float, float]:
    """Round to ~1 km grid to avoid duplicate prefetches for nearby coords."""
    return (round(lat, 2), round(lon, 2))


async def prefetch_tiles_for_location(lat: float, lon: float) -> None:
    key = _round_coord(lat, lon)
    if key in _prefetched:
        return
    _prefetched.add(key)

    total = 0
    skipped = 0
    async with httpx.AsyncClient(
        headers={"User-Agent": "CG-Dashboard/1.0"},
        timeout=15,
    ) as client:
        for z in range(0, MAX_ZOOM + 1):
            tiles = _tiles_in_radius(lat, lon, PREFETCH_RADIUS_KM, z)
            for x, y in tiles:
                if get_cached_tile(z, x, y) is not None:
                    skipped += 1
                    continue
                data = await fetch_tile(client, z, x, y)
                if data:
                    save_tile(z, x, y, data)
                    total += 1
                await asyncio.sleep(PREFETCH_DELAY)

    logger.info(
        "Tile prefetch for (%.2f, %.2f): downloaded %d, skipped %d cached",
        lat, lon, total, skipped,
    )


async def prefetch_for_objects(objects: list[dict]) -> None:
    """Background task: prefetch tiles for all objects with coordinates."""
    for obj in objects:
        lat, lon = obj.get("lat"), obj.get("lon")
        if lat is not None and lon is not None:
            await prefetch_tiles_for_location(lat, lon)
