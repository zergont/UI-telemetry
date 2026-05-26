"""Register enrichment helpers.

Two entry points:
  enrich_register()         – uses MapStore (in-memory, populated from DB catalog).
                              Used by MQTT listener for live WebSocket telemetry.
  enrich_from_catalog_row() – uses a register_catalog DB row returned from a SQL JOIN.
                              Used by HTTP endpoint routers.
"""
from __future__ import annotations

from app.mqtt.map_store import MapStore


# ── HTTP layer: enrich using a JOIN-ed register_catalog row ──────────────────

def enrich_from_catalog_row(row: dict) -> dict:
    """Build an enriched register dict from a DB row that already has catalog columns.

    Expected row keys (from LEFT JOIN register_catalog):
      addr, value, raw,
      name_default, unit_default, register_kind, states_json  (all nullable)
    """
    addr: int = row["addr"]
    value = row.get("value")
    raw = row.get("raw")
    name: str = row.get("name_default") or f"reg {addr}"
    unit: str = row.get("unit_default") or ""
    states_json: dict = row.get("states_json") or {}

    result: dict = {
        "addr": addr,
        "name": name,
        "name_en": name,   # catalog has English names only for now
        "value": value,
        "raw": raw,
        "text": None,
        "unit": unit or None,
        "notes_ru": None,
        "faults": None,
    }

    if unit == "enum" and value is not None:
        key = str(int(value))
        result["text"] = states_json.get(key)

    elif unit == "fault_bitmap" and raw is not None:
        faults = []
        for bit in range(16):
            if (int(raw) >> bit) & 1:
                bit_info: dict = states_json.get(str(bit)) or {}
                faults.append({
                    "bit": bit,
                    "name": bit_info.get("name") or f"bit {bit}",
                    "severity": bit_info.get("severity", "unknown"),
                })
        result["faults"] = faults
        if not states_json:
            result["text"] = f"0x{int(raw):04X}"

    return result


def _text_from_catalog(unit: str, raw, states_json: dict) -> str | None:
    """Compute display text for journal events using catalog metadata."""
    if unit == "enum" and raw is not None:
        key = str(int(raw))
        return states_json.get(key)
    if unit == "fault_bitmap" and raw is not None:
        active = []
        for bit in range(16):
            if (int(raw) >> bit) & 1:
                bit_info: dict = states_json.get(str(bit)) or {}
                active.append(bit_info.get("name") or f"bit {bit}")
        if active:
            return ", ".join(active)
        if states_json:
            return "OK"
        return f"0x{int(raw):04X}"
    return None


# ── WebSocket layer: enrich using MapStore (populated from DB catalog) ────────

def enrich_register(
    device_type: str,
    addr: int,
    value: float | None,
    raw: int | None,
    map_store: MapStore,
) -> dict:
    """Enrich a register value with MapStore metadata.

    MapStore is pre-loaded from register_catalog at startup.
    Returns a dict compatible with RegisterOut schema.
    """
    meta = map_store.get(device_type, addr)

    if meta is None:
        return {
            "addr": addr,
            "name": f"reg {addr}",
            "name_en": f"reg {addr}",
            "value": value,
            "raw": raw,
            "text": None,
            "unit": None,
            "notes_ru": None,
            "faults": None,
        }

    unit: str = meta.get("unit") or ""
    name_en: str = meta.get("name") or f"reg {addr}"
    result: dict = {
        "addr": addr,
        "name": meta.get("name_ru") or name_en,
        "name_en": name_en,
        "value": value,
        "raw": raw,
        "text": None,
        "unit": unit or None,
        "notes_ru": meta.get("notes_ru"),
        "faults": None,
    }

    if unit == "enum":
        key = str(int(value)) if value is not None else ""
        labels_ru: dict = meta.get("labels_ru") or {}
        labels: dict = meta.get("labels") or {}
        result["text"] = (
            labels_ru.get(key)
            or labels.get(key)
            or (f"Unknown ({value})" if value is not None else None)
        )

    elif unit == "fault_bitmap":
        bits_def: dict = meta.get("bits") or {}
        if raw is not None:
            faults = []
            for bit in range(16):
                if (int(raw) >> bit) & 1:
                    bit_info: dict = bits_def.get(str(bit)) or {}
                    faults.append({
                        "bit": bit,
                        "name": (
                            bit_info.get("name_ru")
                            or bit_info.get("name")
                            or f"bit {bit}"
                        ),
                        "severity": bit_info.get("severity", "unknown"),
                    })
            result["faults"] = faults
            if not bits_def:
                result["text"] = f"0x{int(raw):04X}"

    return result
