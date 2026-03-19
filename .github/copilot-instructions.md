# Copilot Instructions

## Рекомендации по проекту
- For chart UX, the user prefers trading-terminal behavior: in live mode, zoom should anchor to the right edge; in manual mode, zoom should behave like a market chart. Preset buttons should be treated as zoom presets and considered active when the current span is within ±10% of the preset.
- Any zoom or pan should exit live mode. Re-enter live mode only by pressing a preset button or by panning (without zooming) back to the future/blue zone. When re-entering live via pan, preserve the current zoom; when re-entering via preset button, use that preset zoom.