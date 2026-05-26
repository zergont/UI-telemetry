"""Helpers for register_catalog table: loading metadata and format conversion."""
from __future__ import annotations

import asyncpg


def catalog_to_meta(row: dict) -> dict:
    """Convert a register_catalog row to the enrichment meta dict format.

    The result is compatible with enrich_from_catalog_row() expectations.
    """
    unit: str = row.get("unit_default") or ""
    states_json: dict = row.get("states_json") or {}
    name: str = row.get("name_default") or ""

    meta: dict = {
        "name": name,
        "name_ru": None,   # catalog does not have Russian names yet
        "unit": unit,
        "notes_ru": None,
    }

    if unit == "enum":
        # states_json: {"0": "AUTO", "1": "MANUAL"}
        meta["labels"] = states_json
        meta["labels_ru"] = {}
    elif unit == "fault_bitmap":
        # states_json: {"0": {"name": "Low Oil Pressure", "severity": "shutdown"}}
        meta["bits"] = states_json

    return meta


async def load_catalog_all(pool: asyncpg.Pool) -> dict[str, dict[str, dict]]:
    """Load entire register_catalog from DB.

    Returns: {equip_type: {addr_str: meta_dict}}
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT equip_type, addr, name_default, unit_default, register_kind, states_json
            FROM register_catalog
            """
        )

    result: dict[str, dict[str, dict]] = {}
    for row in rows:
        et: str = row["equip_type"]
        addr_str = str(row["addr"])
        result.setdefault(et, {})[addr_str] = catalog_to_meta(dict(row))

    return result
