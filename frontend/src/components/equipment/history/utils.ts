import type { ChartPoint, GapZone, HistoryPoint } from "./types";

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
 * «Корзина» уровня зума — меняется только при значимом изменении масштаба.
 * Используется как ключ для инвалидации кэша данных.
 */
export function zoomBucket(spanMs: number): number {
  return Math.floor(Math.log2(Math.max(spanMs, 5000) / 60_000));
}

/* ── Конвертация API → ChartPoint[] ─────────────────────────────────────── */

export function buildChartData(
  points: HistoryPoint[],
  gaps: GapZone[],
): ChartPoint[] {
  const valid = points.filter(
    (p) =>
      p.ts != null &&
      p.value != null &&
      p.reason?.toUpperCase().includes("NA") !== true,
  );

  const converted: ChartPoint[] = valid
    .map((p) => ({
      ts: parseIsoToMs(p.ts!),
      value: p.value!,
      minValue: p.min_value,
      maxValue: p.max_value,
      sampleCount: p.sample_count ?? 1,
      synthetic: p.synthetic ?? false,
    }))
    .filter((p) => isFiniteNumber(p.ts) && isFiniteNumber(p.value as number))
    .sort((a, b) => a.ts - b.ts);

  if (converted.length === 0) return [];

  // Null-bridge для гэпов
  const gapMs = gaps
    .map((g) => ({ from: parseIsoToMs(g.from_ts), to: parseIsoToMs(g.to_ts) }))
    .filter((g) => isFiniteNumber(g.from) && isFiniteNumber(g.to) && g.to > g.from);

  if (gapMs.length === 0) return converted;

  const result: ChartPoint[] = [];
  for (const pt of converted) {
    for (const g of gapMs) {
      if (Math.abs(pt.ts - g.to) < 1000) {
        result.push({ ts: g.from, value: null });
        result.push({ ts: g.to, value: null });
      }
    }
    result.push(pt);
  }

  const seen = new Set<number>();
  return result
    .filter((p) => {
      if (seen.has(p.ts)) return false;
      seen.add(p.ts);
      return true;
    })
    .sort((a, b) => a.ts - b.ts);
}

/* ── Merge двух отсортированных массивов точек ──────────────────────────── */

/**
 * Объединяет два отсортированных по ts массива ChartPoint[].
 * При дубликатах по ts: если один из них null-bridge — оставляем оба (нужны для gap).
 * Иначе берём точку с большим sampleCount (более актуальная агрегация).
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
      // Одинаковый ts — одну из них null-bridge?
      if (pa.value === null || pb.value === null) {
        result.push(pa);
        if (pb.value !== pa.value) result.push(pb);
      } else {
        // Берём более «свежую» (от последнего запроса = b)
        result.push(pb);
      }
      i++;
      j++;
    }
  }

  while (i < a.length) result.push(a[i++]);
  while (j < b.length) result.push(b[j++]);

  return result;
}
