import type { HistoryRangeKey, RegisterOption } from "./types";

export const REGISTER_OPTIONS: RegisterOption[] = [
  { addr: 40034, label: "Нагрузка (кВт)", color: "#22c55e" },
  { addr: 40070, label: "Наработка (сек)", color: "#3b82f6" },
  { addr: 40063, label: "Температура масла", color: "#f97316" },
  { addr: 40062, label: "Давление масла", color: "#a855f7" },
  { addr: 40290, label: "ControllerOn Time", color: "#06b6d4" },
];

export const RANGE_MS: Record<HistoryRangeKey, number> = {
  "1h": 4 * 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export const FUTURE_BUFFER_MS: Record<HistoryRangeKey, number> = {
  "1h": 15 * 60_000,
  "24h": 2 * 3_600_000,
  "7d": 86_400_000,
  "30d": 86_400_000,
};

export const GRID_MS = 2_000;
export const RAW_THRESHOLD_MS = 60_000;
export const SILENT_SYNC_MS = 5 * 60_000;
export const HYSTERESIS = 1.3;
