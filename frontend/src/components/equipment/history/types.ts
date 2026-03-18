export interface ChartPoint {
  ts: number;
  value: number;
  min_value?: number | null;
  max_value?: number | null;
}

export interface GapZone {
  fromMs: number;
  toMs: number;
}

export type HistoryRangeKey = "1h" | "24h" | "7d" | "30d";

export interface RegisterOption {
  addr: number;
  label: string;
  color: string;
}
