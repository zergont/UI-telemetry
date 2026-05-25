"""In-memory store for device register maps received from MQTT retained topics."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class MapStore:
    """Хранит метаданные регистров по device_type.

    Источник: retained-топик cg/v1/maps/<device_type>.
    Обновляется автоматически при переиздании карты (рестарт telemetry2).
    """

    def __init__(self) -> None:
        # device_type → {addr_str → meta_dict}
        self._maps: dict[str, dict[str, dict]] = {}

    def update(self, device_type: str, registers: dict[str, dict]) -> None:
        """Сохранить/обновить карту для device_type."""
        self._maps[device_type] = registers
        logger.info(
            "MapStore: updated device_type=%s (%d registers)",
            device_type,
            len(registers),
        )

    def get(self, device_type: str, addr: int) -> dict | None:
        """Вернуть метаданные регистра или None если карта/регистр не найден."""
        return self._maps.get(device_type, {}).get(str(addr))

    def has(self, device_type: str) -> bool:
        """Получена ли карта для данного типа устройства."""
        return device_type in self._maps
