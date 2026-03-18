import {
  GRID_MS,
  HYSTERESIS,
  RANGE_MS,
  RAW_THRESHOLD_MS,
} from "./constants";
import type { ChartPoint, GapZone, HistoryRangeKey } from "./types";

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

export function spanToRange(
  spanMs: number,
  currentRange: HistoryRangeKey,
): HistoryRangeKey {
  if (currentRange === "1h") {
    return spanMs > RANGE_MS["1h"] * HYSTERESIS ? "24h" : "1h";
  }
  if (currentRange === "24h") {
    if (spanMs <= RANGE_MS["1h"]) return "1h";
    if (spanMs > RANGE_MS["24h"] * HYSTERESIS) return "7d";
    return "24h";
  }
  if (currentRange === "7d") {
    if (spanMs <= RANGE_MS["24h"]) return "24h";
    if (spanMs > RANGE_MS["7d"] * HYSTERESIS) return "30d";
    return "7d";
  }
  if (spanMs <= RANGE_MS["7d"]) return "7d";
  return "30d";
}

export function mergeChartData(a: ChartPoint[], b: ChartPoint[]): ChartPoint[] {
  const map = new Map<number, ChartPoint>();
  for (const p of a) map.set(p.ts, p);
  for (const p of b) map.set(p.ts, p);
  return [...map.values()].sort((x, y) => x.ts - y.ts);
}
