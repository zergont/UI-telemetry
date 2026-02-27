"""Простой in-memory rate limiter для /view/{token}.

Ограничивает количество запросов с одного IP за скользящее окно.
В production заменяется на nginx rate limiting.
"""
from __future__ import annotations

import time
from collections import defaultdict


class RateLimiter:
    def __init__(self, max_requests: int = 20, window_sec: int = 60) -> None:
        self.max_requests = max_requests
        self.window_sec = window_sec
        self._hits: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str) -> bool:
        """Проверить, не превышен ли лимит для данного ключа (IP)."""
        now = time.monotonic()
        cutoff = now - self.window_sec
        hits = self._hits[key]

        # Удаляем старые записи
        self._hits[key] = [t for t in hits if t > cutoff]
        hits = self._hits[key]

        if len(hits) >= self.max_requests:
            return False

        hits.append(now)
        return True

    def cleanup(self) -> None:
        """Удалить устаревшие ключи (вызывать периодически)."""
        now = time.monotonic()
        cutoff = now - self.window_sec
        empty_keys = [
            k for k, v in self._hits.items()
            if not v or v[-1] < cutoff
        ]
        for k in empty_keys:
            del self._hits[k]


# Глобальный экземпляр для /view/{token}
view_limiter = RateLimiter(max_requests=20, window_sec=60)
