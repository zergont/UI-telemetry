"""Register enrichment helpers for HTTP layer.

Uses register_catalog DB columns returned via SQL JOIN — no in-memory state.
"""
from __future__ import annotations


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
        "name_en": name,
        "value": value,
        "raw": raw,
        "text": None,
        "unit": unit or None,
        "notes_ru": None,
        "faults": None,
    }

    if unit == "enum" and value is not None:
        result["text"] = states_json.get(str(int(value)))

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
        return states_json.get(str(int(raw)))
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
