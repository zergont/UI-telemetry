import type { HistoryRangeKey, RegisterOption } from "./types";

export const REGISTER_OPTIONS: RegisterOption[] = [
  { addr: 40034, label: "Нагрузка (кВт)", color: "#22c55e" },
  { addr: 40070, label: "Наработка (сек)", color: "#3b82f6" },
  { addr: 40063, label: "Температура масла", color: "#f97316" },
  { addr: 40062, label: "Давление масла", color: "#a855f7" },
  { addr: 40290, label: "ControllerOn Time", color: "#06b6d4" },
];

export const RANGE_MS: Record<HistoryRangeKey, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export const FUTURE_BUFFER_MS: Record<HistoryRangeKey, number> = {
  "1h": 5 * 60_000,
  "24h": 60 * 60_000,
  "7d": 6 * 3_600_000,
  "30d": 12 * 3_600_000,
};

export const GRID_MS = 2_000;
export const RAW_THRESHOLD_MS = 60_000;
export const LIVE_TICK_MS = 5_000;
export const HISTORY_FETCH_BUCKET_MS = 60_000;
export const MIN_VISIBLE_SPAN_MS = 30_000;
export const PRESET_MATCH_TOLERANCE = 0.1;
export const QUERY_MARGIN_RATIO = 0.15;
export const FULL_HISTORY_LEFT_PAD_RATIO = 0.05;
export const FULL_HISTORY_LEFT_PAD_MIN_MS = 5 * 60_000;
export const MAX_FUTURE_BUFFER_MS = FUTURE_BUFFER_MS["30d"];
