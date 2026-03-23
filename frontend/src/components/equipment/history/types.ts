/* ── Chart types ─────────────────────────────────────────────────────────── */

export interface ViewportRange {
  from: number; // Unix ms
  to: number;   // Unix ms
}

export interface ChartPoint {
  ts: number;           // Unix ms
  value: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  sampleCount?: number;
  synthetic?: boolean;  // deprecated (v3.0: не используется)
}

/* ── API types ──────────────────────────────────────────────────────────── */

export interface HistoryPoint {
  ts: string | null;
  value: number | null;
  min_value: number | null;
  max_value: number | null;
  open_value: number | null;
  close_value: number | null;
  sample_count: number | null;
  synthetic: boolean | null;
  text: string | null;
  reason: string | null;
}

export interface GapZone {
  from_ts: string;
  to_ts: string;
}

export interface HistoryResponse {
  points: HistoryPoint[];
  first_data_at: string | null;
  gaps: GapZone[];
}
