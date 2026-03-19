import {
  FULL_HISTORY_LEFT_PAD_MIN_MS,
  FULL_HISTORY_LEFT_PAD_RATIO,
  FUTURE_BUFFER_MS,
  GRID_MS,
  MAX_FUTURE_BUFFER_MS,
  MIN_VISIBLE_SPAN_MS,
  PRESET_MATCH_TOLERANCE,
  RANGE_MS,
  RAW_THRESHOLD_MS,
} from "./constants";
import type { ChartPoint, GapZone, HistoryRangeKey, ViewportRange } from "./types";

export function interpolateToGrid(
  rawPoints: ChartPoint[],
  gapZones: GapZone[],
): { interpolated: ChartPoint[]; rawTimestamps: Set<number> } {
  const rawTimestamps = new Set<number>(rawPoints.map((p) => p.ts));
  if (rawPoints.length < 2) return { interpolated: rawPoints, rawTimestamps };

  const intervals: number[] = [];
  for (let i = 1; i < rawPoints.length; i++) {
    intervals.push(rawPoints[i].ts - rawPoints[i - 1].ts);
  }
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];

  if (median > RAW_THRESHOLD_MS) return { interpolated: rawPoints, rawTimestamps };

  const result: ChartPoint[] = [];
  for (let i = 0; i < rawPoints.length; i++) {
    result.push(rawPoints[i]);
    if (i < rawPoints.length - 1) {
      const p0 = rawPoints[i];
      const p1 = rawPoints[i + 1];
      const gapMs = p1.ts - p0.ts;
      const isGap = gapZones.some((g) => g.fromMs < p1.ts && g.toMs > p0.ts);
      if (!isGap && gapMs > GRID_MS) {
        const steps = Math.floor(gapMs / GRID_MS);
        for (let j = 1; j < steps; j++) {
          const t = p0.ts + j * GRID_MS;
          const ratio = (t - p0.ts) / gapMs;
          result.push({ ts: t, value: p0.value + ratio * (p1.value - p0.value) });
        }
      }
    }
  }

  return { interpolated: result, rawTimestamps };
}

export function getMatchingPreset(spanMs: number): HistoryRangeKey | null {
  for (const key of Object.keys(RANGE_MS) as HistoryRangeKey[]) {
    const presetSpan = RANGE_MS[key];
    if (Math.abs(spanMs - presetSpan) / presetSpan <= PRESET_MATCH_TOLERANCE) {
      return key;
    }
  }
  return null;
}

export function getFutureBufferMs(spanMs: number): number {
  let closest: HistoryRangeKey = "24h";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const key of Object.keys(RANGE_MS) as HistoryRangeKey[]) {
    const distance = Math.abs(Math.log(spanMs / RANGE_MS[key]));
    if (distance < bestDistance) {
      bestDistance = distance;
      closest = key;
    }
  }

  return FUTURE_BUFFER_MS[closest] ?? MAX_FUTURE_BUFFER_MS;
}

export function clampVisibleSpan(spanMs: number, maxSpanMs: number | null): number {
  const clamped = Math.max(spanMs, MIN_VISIBLE_SPAN_MS);
  if (maxSpanMs == null) return clamped;
  return Math.min(clamped, maxSpanMs);
}

export function computeMaxVisibleSpan(firstDataAt: number | null, nowMs: number): number | null {
  if (firstDataAt == null) return null;
  const historySpan = Math.max(nowMs - firstDataAt, MIN_VISIBLE_SPAN_MS);
  const leftPad = Math.max(FULL_HISTORY_LEFT_PAD_MIN_MS, historySpan * FULL_HISTORY_LEFT_PAD_RATIO);
  const leftEdge = Math.max(0, firstDataAt - leftPad);
  return nowMs + MAX_FUTURE_BUFFER_MS - leftEdge;
}

export function alignViewportToLive(
  spanMs: number,
  nowMs: number,
  futureBufferMs: number,
): ViewportRange {
  const to = nowMs + futureBufferMs;
  return {
    from: to - spanMs,
    to,
  };
}

export function makeViewportFromCenter(centerMs: number, spanMs: number): ViewportRange {
  return {
    from: centerMs - spanMs / 2,
    to: centerMs + spanMs / 2,
  };
}
