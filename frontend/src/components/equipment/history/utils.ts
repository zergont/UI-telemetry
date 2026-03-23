import type { ChartPoint, HistoryPoint } from "./types";

/* ── Примитивы ──────────────────────────────────────────────────────────── */

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function parseIsoToMs(iso: string): number {
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`).getTime();
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ── Target points ──────────────────────────────────────────────────────── */

/**
 * Оптимальное количество точек для запроса.
 * При глубоком зуме → больше точек (до raw), при обзоре → меньше.
 */
export function calcTargetPoints(spanMs: number): number {
  const screenW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const ONE_HOUR = 3_600_000;
  const ONE_DAY = 86_400_000;
  let density: number;
  if (spanMs <= ONE_HOUR) density = 4;
  else if (spanMs <= ONE_DAY) density = 2;
  else density = 1;
  return clamp(Math.round(screenW * density), 500, 20_000);
}

/**
 * «Корзина» источника данных — инвалидирует кэш ТОЛЬКО при смене таблицы.
 *   0 = history (raw),  span ≤ 30 дней
 *   1 = history_1min,   span ≤ 90 дней
 *   2 = history_1hour,  span >  90 дней
 * При зуме внутри одного источника кэш НЕ сбрасывается — подгрузка инкрементальная.
 */
export function zoomBucket(spanMs: number): number {
  const spanSec = spanMs / 1000;
  if (spanSec <= 30 * 86_400) return 0;   // raw
  if (spanSec <= 90 * 86_400) return 1;   // 1min
  return 2;                                 // 1hour
}

/* ── Конвертация API → ChartPoint[] ─────────────────────────────────────── */

export function buildChartData(points: HistoryPoint[]): ChartPoint[] {
  return points
    .filter(
      (p) =>
        p.ts != null &&
        p.value != null &&
        p.reason?.toUpperCase().includes("NA") !== true,
    )
    .map((p) => ({
      ts: parseIsoToMs(p.ts!),
      value: p.value!,
      minValue: p.min_value,
      maxValue: p.max_value,
      sampleCount: p.sample_count ?? 1,
    }))
    .filter((p) => isFiniteNumber(p.ts) && isFiniteNumber(p.value as number))
    .sort((a, b) => a.ts - b.ts);
}

/* ── Merge двух отсортированных массивов точек ──────────────────────────── */

/**
 * Объединяет два отсортированных по ts массива ChartPoint[].
 * При дубликатах по ts берём точку от последнего запроса (b).
 */
export function mergePoints(a: ChartPoint[], b: ChartPoint[]): ChartPoint[] {
  const result: ChartPoint[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    const pa = a[i];
    const pb = b[j];

    if (pa.ts < pb.ts) {
      result.push(pa);
      i++;
    } else if (pa.ts > pb.ts) {
      result.push(pb);
      j++;
    } else {
      // Одинаковый ts — берём более свежую (b)
      result.push(pb);
      i++;
      j++;
    }
  }

  while (i < a.length) result.push(a[i++]);
  while (j < b.length) result.push(b[j++]);

  return result;
}
