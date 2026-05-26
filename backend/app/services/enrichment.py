"""Обогащение регистров метаданными из register_catalog (HTTP-слой).

Использует колонки из SQL JOIN — никакого состояния в памяти.
"""
from __future__ import annotations


def enrich_from_catalog_row(row: dict) -> dict:
    """Собрать обогащённый dict из строки БД с присоединёнными колонками каталога.

    Ожидаемые ключи (из LEFT JOIN register_catalog):
      addr, value, raw,
      name_default, unit_default, register_kind, states_json  (все nullable)

    states_json для enum:   {"labels_ru": {"0": "АВТО"}, "labels": {"0": "AUTO"}}
    states_json для bitmap: {"0": {"name": "...", "name_ru": "...", "severity": "..."}}
    """
    addr: int = row["addr"]
    value = row.get("value")
    raw = row.get("raw")
    name_en: str = row.get("name_default") or f"reg {addr}"
    name: str = row.get("name_ru") or name_en   # русское, fallback на английское
    unit: str = row.get("unit_default") or ""
    states_json: dict = row.get("states_json") or {}

    result: dict = {
        "addr": addr,
        "name": name,
        "name_en": name_en,
        "value": value,
        "raw": raw,
        "text": None,
        "unit": unit or None,
        "notes_ru": None,
        "faults": None,
    }

    if unit == "enum" and value is not None:
        key = str(int(value))
        labels_ru: dict = states_json.get("labels_ru") or {}
        labels: dict = states_json.get("labels") or {}
        result["text"] = labels_ru.get(key) or labels.get(key)

    elif unit == "fault_bitmap" and raw is not None:
        faults = []
        for bit in range(16):
            if (int(raw) >> bit) & 1:
                bit_info: dict = states_json.get(str(bit)) or {}
                faults.append({
                    "bit": bit,
                    "name": bit_info.get("name_ru") or bit_info.get("name") or f"bit {bit}",
                    "severity": bit_info.get("severity", "unknown"),
                })
        result["faults"] = faults
        if not states_json:
            result["text"] = f"0x{int(raw):04X}"

    return result


def _text_from_catalog(unit: str, raw, states_json: dict) -> str | None:
    """Вычислить текст для события журнала по метаданным каталога."""
    if unit == "enum" and raw is not None:
        key = str(int(raw))
        labels_ru: dict = states_json.get("labels_ru") or {}
        labels: dict = states_json.get("labels") or {}
        return labels_ru.get(key) or labels.get(key)

    if unit == "fault_bitmap" and raw is not None:
        active = []
        for bit in range(16):
            if (int(raw) >> bit) & 1:
                bit_info: dict = states_json.get(str(bit)) or {}
                active.append(
                    bit_info.get("name_ru") or bit_info.get("name") or f"bit {bit}"
                )
        if active:
            return ", ".join(active)
        if states_json:
            return "OK"
        return f"0x{int(raw):04X}"

    return None
