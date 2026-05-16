"""OSM tile proxy endpoint with disk caching."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.services.tile_cache import get_or_fetch_tile

router = APIRouter(prefix="/api/tiles", tags=["tiles"])


@router.get("/{z}/{x}/{y}.png")
async def tile_proxy(z: int, x: int, y: int):
    if z < 0 or z > 19 or x < 0 or y < 0:
        raise HTTPException(status_code=400, detail="Invalid tile coordinates")
    n = 2 ** z
    if x >= n or y >= n:
        raise HTTPException(status_code=400, detail="Invalid tile coordinates")

    data = await get_or_fetch_tile(z, x, y)
    if data is None:
        raise HTTPException(status_code=502, detail="Tile fetch failed")

    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )
