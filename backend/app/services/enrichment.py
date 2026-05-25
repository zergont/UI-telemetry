"""Enrichment: склейка значений регистров с метаданными из MapStore."""
from __future__ import annotations

from app.mqtt.map_store import MapStore


def enrich_register(
    device_type: str,
    addr: int,
    value: float | None,
    raw: int | None,
    map_store: MapStore,
) -> dict:
    """Обогатить регистр метаданными из MapStore.

    Возвращает dict, совместимый с RegisterOut:
      addr, name, value, raw, text, unit, notes_ru, faults
    """
    meta = map_store.get(device_type, addr)

    if meta is None:
        # Карта ещё не пришла или регистр не описан
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

    unit = meta.get("unit") or ""
    name_en = meta.get("name", f"reg {addr}")
    result: dict = {
        "addr": addr,
        "name": meta.get("name_ru") or name_en,   # русское имя (основное)
        "name_en": name_en,                         # английское (для tooltip)
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
                    bit_info = bits_def.get(str(bit)) or {}
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
            # Если биты не оцифрованы — показываем raw в hex
            if not bits_def:
                result["text"] = f"0x{int(raw):04X}"

    return result
