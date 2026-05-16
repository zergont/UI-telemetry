"""OSM tile proxy endpoint with disk caching."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.auth import AuthContext, require_admin, require_auth
from app.services.tile_cache import (
    cache_file_count,
    cache_size_bytes,
    clear_cache,
    get_or_fetch_tile,
)

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


@router.get("/cache/stats")
async def tile_cache_stats(_: AuthContext = Depends(require_auth)):
    size = cache_size_bytes()
    count = cache_file_count()
    return {"size_bytes": size, "file_count": count}


@router.delete("/cache")
async def tile_cache_clear(_: AuthContext = Depends(require_admin)):
    count = clear_cache()
    return {"ok": True, "deleted": count}
