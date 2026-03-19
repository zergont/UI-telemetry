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

export type CameraMode = "live" | "manual";

export interface ViewportRange {
  from: number;
  to: number;
}

export interface ViewportCommand extends ViewportRange {
  key: number;
}

export interface ViewportChangeEvent extends ViewportRange {
  spanMs: number;
  centerMs: number;
  interaction: "zoom" | "pan";
  hasFutureZone: boolean;
}

export interface RegisterOption {
  addr: number;
  label: string;
  color: string;
}
