/**
 * HistoryChart — обёртка над lightweight-charts v5 (биржевой паттерн).
 *
 * Принцип работы:
 *  • Данные загружаются при смене диапазона (≤2000 точек от backend).
 *  • Pan — свободный, без API. Когда >50% видимой области за краем данных —
 *    срабатывает onNeedData для подгрузки.
 *  • Zoom — при изменении масштаба (>15% span) → onNeedData с новым span/center.
 *  • Live — данные обновляются снаружи, авто-скролл если пользователь не двигал.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  AreaSeries,
  LineSeries,
} from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  Time,
  AutoscaleInfo,
  ISeriesPrimitive,
  SeriesAttachedParameter,
} from "lightweight-charts";
import { useSettingsStore } from "@/stores/settings-store";

// ── Часовой пояс ──────────────────────────────────────────────────────────────
// lightweight-charts позиционирует точки по UTC.
// Чтобы ось показывала локальное время, сдвигаем timestamp'ы на tzOffsetSec
// при записи и обратно при чтении. Смещение берётся из настроек (settings-store).

/** UTC epoch ms → "TZ-shifted" epoch sec (для записи в график) */
function toChartTime(utcMs: number, tzOffsetSec: number): number {
  return utcMs / 1000 + tzOffsetSec;
}

/** "TZ-shifted" epoch sec → UTC epoch ms (при чтении из графика) */
function fromChartTime(chartSec: number, tzOffsetSec: number): number {
  return (chartSec - tzOffsetSec) * 1000;
}

// ── Фоновые зоны (Custom Primitive) ──────────────────────────────────────────
// Рисуем прямо на canvas через lightweight-charts v5 ISeriesPrimitive.
// Зоны — статические прямоугольники на всю высоту панели:
//   серый  — до первой записи в БД (нет исторических данных)
//   красный — разрывы данных (пропало N точек подряд)
//   синий  — будущее время (данные ещё не пришли)

interface ZoneData {
  fromMs: number;   // epoch ms
  toMs:   number;   // epoch ms
  color:  string;   // rgba
}

class ZonesPrimitive implements ISeriesPrimitive<Time> {
  private _zones: ZoneData[]       = [];
  private _chart: IChartApi | null = null;
  private _tzRef: { current: number };
  private _requestUpdate?: () => void;
  /** Диапазон загруженных данных (epoch ms) — для определения направления null */
  private _dataMinMs: number | null = null;
  private _dataMaxMs: number | null = null;

  // Стабильные ссылки — не пересоздаём объекты каждый кадр
  private _renderer = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    draw: (target: any) => this._draw(target),
  };
  private _view = {
    renderer:  () => this._renderer,
    zOrder:    () => "bottom" as const,
  };

  constructor(tzRef: { current: number }) {
    this._tzRef = tzRef;
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this._chart          = p.chart;
    this._requestUpdate  = p.requestUpdate;
  }

  detached(): void {
    this._chart         = null;
    this._requestUpdate = undefined;
  }

  /** Обновить диапазон данных (для корректного позиционирования зон за краями). */
  setDataRange(minMs: number | null, maxMs: number | null): void {
    this._dataMinMs = minMs;
    this._dataMaxMs = maxMs;
  }

  updateZones(zones: ZoneData[]): void {
    this._zones = zones;
    this._requestUpdate?.();
  }

  forceRedraw(): void {
    this._requestUpdate?.();
  }

  paneViews() {
    if (!this._chart) return [];
    return [this._view];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _draw(target: any): void {
    const chart = this._chart;
    if (!chart || this._dataMinMs === null || this._dataMaxMs === null) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio }: any) => {
      const ts = chart.timeScale();
      const tz = this._tzRef.current;
      const W  = bitmapSize.width / horizontalPixelRatio;
      const H  = bitmapSize.height;

      // Диапазон данных в TZ-shifted sec
      const dataMinSec = this._dataMinMs! / 1000 + tz;
      const dataMaxSec = this._dataMaxMs! / 1000 + tz;

      for (const z of this._zones) {
        const fromSec = z.fromMs / 1000 + tz;
        const toSec   = z.toMs   / 1000 + tz;

        const rawX0 = ts.timeToCoordinate(fromSec as Time);
        const rawX1 = ts.timeToCoordinate(toSec   as Time);

        // ── x0: null → определяем правее или левее данных ──────────────────
        let x0: number;
        if (rawX0 !== null) {
          x0 = rawX0;
        } else if (fromSec > dataMaxSec) {
          // зона начинается ПРАВЕЕ всех данных → ничего видимого → пропускаем
          continue;
        } else {
          // зона начинается ЛЕВЕЕ всех данных → прижимаем к левому краю
          x0 = 0;
        }

        // ── x1: null → определяем правее или левее данных ──────────────────
        let x1: number;
        if (rawX1 !== null) {
          x1 = rawX1;
        } else if (toSec <= dataMaxSec) {
          // Timestamp в пределах (или до) данных, но timeToCoordinate вернул null:
          // это значит точка вне видимой области (слева) или попала между баров
          // (on-the-fly агрегация → exact-ts не совпадает с бакетом).
          // В обоих случаях зона кончается левее экрана → пропускаем.
          continue;
        } else {
          // Timestamp правее последних данных (будущее) → прижимаем к правому краю
          x1 = W;
        }

        if (x1 <= x0) continue;

        context.fillStyle = z.color;
        context.fillRect(
          Math.round(x0 * horizontalPixelRatio),
          0,
          Math.round((x1 - x0) * horizontalPixelRatio),
          H,
        );
      }
    });
  }
}

/**
 * Собирает массив зон.
 *
 * dataMaxMs — последняя точка в загруженных данных (epoch ms).
 * Синяя зона начинается именно отсюда, а не от Date.now(), иначе
 * timeToCoordinate(now) вернёт null (нет данных с таким timestamp) и
 * координата x0 ошибочно прижмётся к левому краю canvas.
 */
function buildZones(
  firstDataAt: number | null | undefined,
  gaps: Array<{ fromMs: number; toMs: number }> | undefined,
  dataMaxMs: number | null,
): ZoneData[] {
  const zones: ZoneData[] = [];

  // Серая: до первой записи в БД
  if (firstDataAt != null) {
    zones.push({ fromMs: 0, toMs: firstDataAt, color: "rgba(156,163,175,0.15)" });
  }

  // Красные: разрывы данных
  for (const g of gaps ?? []) {
    zones.push({ fromMs: g.fromMs, toMs: g.toMs, color: "rgba(239,68,68,0.18)" });
  }

  // Синяя: от последней точки данных до «вечности» (обрежется до края canvas)
  if (dataMaxMs !== null) {
    zones.push({ fromMs: dataMaxMs, toMs: dataMaxMs + 10 * 365 * 86_400_000, color: "rgba(59,130,246,0.12)" });
  }

  return zones;
}

// ── Типы ─────────────────────────────────────────────────────────────────────

export interface ChartPoint {
  ts: number;       // epoch ms
  value: number;
  min_value?: number | null;
  max_value?: number | null;
}

export interface HistoryChartHandle {
  /** Сбросить ручной зум/пан и вписать все данные */
  fitContent(): void;
  /** Показать конкретный диапазон (epoch ms), остальные данные — буфер для пана */
  setVisibleRange(fromMs: number, toMs: number): void;
}

interface HistoryChartProps {
  data: ChartPoint[];
  label?: string;
  color?: string;
  isLoading?: boolean;
  /**
   * Вызывается когда нужны новые данные:
   *  • zoom изменил масштаб → другая детализация
   *  • pan достиг края данных → нужна подгрузка
   * visibleSpanMs — видимый диапазон, centerMs — центр видимой области.
   */
  onNeedData?: (visibleSpanMs: number, centerMs: number) => void;
  /** Желаемый видимый диапазон (epoch ms). Применяется СРАЗУ после setData. */
  pendingRange?: { from: number; to: number; key: number } | null;
  /** Первая запись в БД для этого регистра (epoch ms) — граница серой зоны */
  firstDataAt?: number | null;
  /** Разрывы данных от backend (epoch ms) — красные зоны */
  gaps?: Array<{ fromMs: number; toMs: number }>;
}

const CHART_HEIGHT = 380;
const DEBOUNCE_MS      = 400;
const FIT_SUPPRESS_MS  = 600;
/** Минимальное изменение span чтобы считать zoom, а не pan */
const ZOOM_THRESHOLD   = 0.15;
/** Доля видимой области за краем данных, при которой запрашиваем подгрузку.
 *  0.3 = когда 30%+ видимой области за краем данных → подгрузка начинается рано,
 *  пользователь не видит пустых зон. */
const EDGE_THRESHOLD   = 0.3;

export const HistoryChart = forwardRef<HistoryChartHandle, HistoryChartProps>(
  function HistoryChart({ data, color = "#22c55e", isLoading = false, onNeedData, pendingRange, firstDataAt, gaps }, ref) {
    const tzOffsetHours   = useSettingsStore((s) => s.tzOffsetHours);
    const tzOffsetSec     = tzOffsetHours * 3600;
    const tzOffsetSecRef  = useRef(tzOffsetSec);
    tzOffsetSecRef.current = tzOffsetSec;

    const containerRef    = useRef<HTMLDivElement>(null);
    const chartRef        = useRef<IChartApi | null>(null);
    const seriesRef       = useRef<ISeriesApi<"Area"> | null>(null);
    const bandHighRef     = useRef<ISeriesApi<"Line"> | null>(null);
    const bandLowRef      = useRef<ISeriesApi<"Line"> | null>(null);
    const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suppressRef     = useRef(false);
    /** true = пользователь двигал/зумил; setData НЕ вызывает fitContent */
    const userTouchedRef  = useRef(false);
    /** Предыдущий видимый span — для определения zoom vs pan */
    const prevSpanRef     = useRef<number | null>(null);
    /** Границы загруженных данных (epoch ms) */
    const dataRangeRef    = useRef<{ min: number; max: number } | null>(null);
    /** Последний применённый pendingRange.key — чтобы не применять повторно */
    const lastAppliedRangeKeyRef = useRef(-1);

    const zonePrimitiveRef = useRef<ZonesPrimitive | null>(null);

    const latestDataRef   = useRef(data);
    const latestColorRef  = useRef(color);
    latestDataRef.current  = data;
    latestColorRef.current = color;
    const onNeedDataRef = useRef(onNeedData);
    onNeedDataRef.current = onNeedData;

    // ── Императивный хэндл ───────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      fitContent() {
        if (!chartRef.current) return;
        userTouchedRef.current = false;
        prevSpanRef.current    = null;
        suppressRef.current    = true;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        chartRef.current.timeScale().fitContent();
        debounceRef.current = setTimeout(() => {
          suppressRef.current = false;
        }, FIT_SUPPRESS_MS);
      },
      setVisibleRange(fromMs: number, toMs: number) {
        if (!chartRef.current) return;
        userTouchedRef.current = false;
        prevSpanRef.current    = null;
        suppressRef.current    = true;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        chartRef.current.timeScale().setVisibleRange({
          from: toChartTime(fromMs, tzOffsetSecRef.current) as Time,
          to:   toChartTime(toMs,   tzOffsetSecRef.current) as Time,
        });
        debounceRef.current = setTimeout(() => {
          suppressRef.current = false;
        }, FIT_SUPPRESS_MS);
      },
    }));

    // ── Инициализация графика (один раз) ────────────────────────────────────
    useEffect(() => {
      if (!containerRef.current) return;

      const chart = createChart(containerRef.current, {
        height: CHART_HEIGHT,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#9ca3af",
          fontFamily: "inherit",
        },
        grid: {
          vertLines: { color: "#1f2937" },
          horzLines: { color: "#1f2937" },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "#4b5563", labelBackgroundColor: "#374151" },
          horzLine: { color: "#4b5563", labelBackgroundColor: "#374151" },
        },
        rightPriceScale: {
          borderColor: "#374151",
          scaleMargins: { top: 0.1, bottom: 0.05 },
          minimumWidth: 60,
        },
        timeScale: {
          borderColor: "#374151",
          timeVisible: true,
          secondsVisible: true,
          rightOffset: 5,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale:  { mouseWheel: true, pinch: true },
      });

      const c = latestColorRef.current;
      const series = chart.addSeries(AreaSeries, {
        lineColor:   c,
        topColor:    c + "33",
        bottomColor: c + "00",
        lineWidth: 1,
        priceFormat: { type: "price", precision: 1, minMove: 0.1 },
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
          const res = original();
          if (!res) return res;
          return {
            priceRange: { minValue: 0, maxValue: res.priceRange?.maxValue ?? 0 },
            margins: res.margins,
          };
        },
      });

      const bandHigh = chart.addSeries(LineSeries, {
        color: c + "55", lineWidth: 1, lineStyle: 2,
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      });
      const bandLow = chart.addSeries(LineSeries, {
        color: c + "55", lineWidth: 1, lineStyle: 2,
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      });

      // Примитив фоновых зон — аттачим к основной серии
      const zones = new ZonesPrimitive(tzOffsetSecRef);
      series.attachPrimitive(zones);
      zonePrimitiveRef.current = zones;

      chartRef.current    = chart;
      seriesRef.current   = series;
      bandHighRef.current = bandHigh;
      bandLowRef.current  = bandLow;

      // Начальные данные (видимый диапазон устанавливается родителем через setVisibleRange)
      const initialData = latestDataRef.current;
      if (initialData.length) {
        applyData(series, bandHigh, bandLow, initialData, tzOffsetSecRef.current);
        updateDataRange(initialData);
      }

      // ── Подписка на viewport change ───────────────────────────────────
      const timeScale = chart.timeScale();
      const handler = () => {
        if (suppressRef.current) return;
        userTouchedRef.current = true;

        // Используем ЛОГИЧЕСКИЙ диапазон для zoom detection
        // (getVisibleRange возвращает TIME только по существующим данным,
        //  при пане за край span ложно уменьшается → ложный zoom)
        const lr = timeScale.getVisibleLogicalRange();
        if (!lr) return;
        const logicalSpan = lr.to - lr.from;

        // TIME диапазон — для center расчёта
        const vr = timeScale.getVisibleRange();

        const nowMs  = Date.now();
        const prev   = prevSpanRef.current;

        // Оценка реального viewport span через логический диапазон и плотность данных
        // (getVisibleRange даёт TIME только для видимых данных — при пане за край
        //  timeSpan сжимается, давая ложный edge detection)
        const dr = dataRangeRef.current;
        let estimatedViewportSpanMs: number;
        if (dr && dr.max > dr.min) {
          // Среднее время на 1 логическую единицу = (dataRange) / (totalDataBars)
          // totalDataBars ≈ last logical index of data. Approximation: use lr.to when
          // viewport is at default position, but simpler: data time / data logical range
          const dataCount = latestDataRef.current.length;
          if (dataCount > 1) {
            const msPerBar = (dr.max - dr.min) / (dataCount - 1);
            estimatedViewportSpanMs = logicalSpan * msPerBar;
          } else {
            estimatedViewportSpanMs = logicalSpan * 1000; // fallback 1s/bar
          }
        } else {
          estimatedViewportSpanMs = logicalSpan * 1000;
        }

        // Center: если есть видимые данные — используем их center,
        // иначе оцениваем по логическому сдвигу
        let center: number;
        let fromMs: number;
        let toMs: number;
        if (vr) {
          fromMs = fromChartTime(vr.from as number, tzOffsetSecRef.current);
          toMs   = fromChartTime(vr.to   as number, tzOffsetSecRef.current);
          center = (fromMs + toMs) / 2;
        } else {
          // Нет видимых данных — оценим center через логический диапазон
          if (dr) {
            const dataCount = latestDataRef.current.length;
            const msPerBar = dataCount > 1 ? (dr.max - dr.min) / (dataCount - 1) : 1000;
            const viewportCenterLogical = (lr.from + lr.to) / 2;
            center = dr.min + viewportCenterLogical * msPerBar;
          } else {
            return;
          }
          fromMs = center - estimatedViewportSpanMs / 2;
          toMs   = center + estimatedViewportSpanMs / 2;
        }

        // Если ушли СЛИШКОМ далеко в будущее — пропускаем
        // (порог 3ч: учитываем futureBuffer до 2ч + небольшой запас)
        if (toMs > nowMs + 3 * 3_600_000) {
          return;
        }

        let needFetch = false;

        // 1) Zoom: ЛОГИЧЕСКИЙ span изменился значительно
        if (prev !== null && Math.abs(logicalSpan - prev) / prev > ZOOM_THRESHOLD) {
          needFetch = true;
        }

        // 2) Pan edge: используем estimated viewport span для корректного overlap
        if (!needFetch && dr) {
          const overlap = Math.max(0, Math.min(toMs, dr.max) - Math.max(fromMs, dr.min));
          const overlapRatio = overlap / estimatedViewportSpanMs;
          if (overlapRatio < (1 - EDGE_THRESHOLD)) {
            needFetch = true;
          }
        }

        prevSpanRef.current = logicalSpan;

        if (needFetch) {
          const cb = onNeedDataRef.current;
          if (cb) {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              if (suppressRef.current) return;
              cb(estimatedViewportSpanMs, center);
            }, DEBOUNCE_MS);
          }
        }
      };

      timeScale.subscribeVisibleTimeRangeChange(handler);

      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      ro.observe(containerRef.current);

      return () => {
        timeScale.unsubscribeVisibleTimeRangeChange(handler);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        ro.disconnect();
        chart.remove(); // примитив detach-ится автоматически
        chartRef.current       = null;
        seriesRef.current      = null;
        bandHighRef.current    = null;
        bandLowRef.current     = null;
        zonePrimitiveRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Обновление данных ────────────────────────────────────────────────────
    useEffect(() => {
      if (!seriesRef.current || !bandHighRef.current || !bandLowRef.current) return;

      if (!data.length) {
        seriesRef.current.setData([]);
        bandHighRef.current.setData([]);
        bandLowRef.current.setData([]);
        dataRangeRef.current = null;
        return;
      }

      applyData(seriesRef.current, bandHighRef.current, bandLowRef.current, data, tzOffsetSecRef.current);
      updateDataRange(data);

      // Применяем pendingRange СРАЗУ после setData — без таймаутов
      if (pendingRange && pendingRange.key !== lastAppliedRangeKeyRef.current) {
        lastAppliedRangeKeyRef.current = pendingRange.key;
        userTouchedRef.current = false;
        prevSpanRef.current    = null;
        suppressRef.current    = true;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const fromSec = toChartTime(pendingRange.from, tzOffsetSecRef.current);
        const toSec   = toChartTime(pendingRange.to,   tzOffsetSecRef.current);
        const spanH   = (toSec - fromSec) / 3600;
        console.log(`[HistoryChart] setVisibleRange: ${new Date(pendingRange.from).toISOString()} → ${new Date(pendingRange.to).toISOString()} (${spanH.toFixed(1)}ч)`);
        chartRef.current!.timeScale().setVisibleRange({
          from: fromSec as Time,
          to:   toSec   as Time,
        });
        debounceRef.current = setTimeout(() => {
          suppressRef.current = false;
        }, FIT_SUPPRESS_MS);
      }
    }, [data, pendingRange]);

    // ── Обновление фоновых зон ───────────────────────────────────────────────
    // Зависимость от data гарантирует, что dataRangeRef уже обновлён
    // (эффект [data, pendingRange] выполняется раньше этого).
    useEffect(() => {
      const dr = dataRangeRef.current;
      const prim = zonePrimitiveRef.current;
      if (!prim) return;
      prim.setDataRange(dr?.min ?? null, dr?.max ?? null);
      prim.updateZones(buildZones(firstDataAt, gaps, dr?.max ?? null));
    }, [data, firstDataAt, gaps]);

    // При смене часового пояса перерисовываем зоны (tz учитывается в draw)
    useEffect(() => {
      zonePrimitiveRef.current?.forceRedraw();
    }, [tzOffsetSec]);

    // ── Обновляем цвет ──────────────────────────────────────────────────────
    useEffect(() => {
      if (!seriesRef.current || !bandHighRef.current || !bandLowRef.current) return;
      seriesRef.current.applyOptions({
        lineColor:   color,
        topColor:    color + "33",
        bottomColor: color + "00",
      });
      bandHighRef.current.applyOptions({ color: color + "55" });
      bandLowRef.current.applyOptions({ color: color + "55" });
    }, [color]);

    // ── Обновить границы загруженных данных ──────────────────────────────────
    function updateDataRange(pts: ChartPoint[]) {
      if (!pts.length) { dataRangeRef.current = null; return; }
      let min = pts[0].ts, max = pts[0].ts;
      for (const p of pts) {
        if (p.ts < min) min = p.ts;
        if (p.ts > max) max = p.ts;
      }
      dataRangeRef.current = { min, max };
    }

    return (
      <div className="relative rounded-xl overflow-hidden border border-border">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px] rounded-xl pointer-events-none">
            <span className="text-xs text-muted-foreground animate-pulse">загрузка…</span>
          </div>
        )}
        <div ref={containerRef} style={{ height: CHART_HEIGHT }} />
      </div>
    );
  }
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function applyData(
  series: ISeriesApi<"Area">,
  bandHigh: ISeriesApi<"Line">,
  bandLow: ISeriesApi<"Line">,
  data: ChartPoint[],
  tzOffsetSec: number,
) {
  const sorted = [...data].sort((a, b) => a.ts - b.ts);

  series.setData(
    sorted.map((p) => ({ time: toChartTime(p.ts, tzOffsetSec) as Time, value: p.value }))
  );

  const hasBand = sorted.some(
    (p) => p.min_value != null && p.max_value != null && p.min_value !== p.max_value
  );

  if (hasBand) {
    bandHigh.setData(
      sorted.map((p) => ({ time: toChartTime(p.ts, tzOffsetSec) as Time, value: p.max_value ?? p.value }))
    );
    bandLow.setData(
      sorted.map((p) => ({ time: toChartTime(p.ts, tzOffsetSec) as Time, value: p.min_value ?? p.value }))
    );
  } else {
    bandHigh.setData([]);
    bandLow.setData([]);
  }
}
