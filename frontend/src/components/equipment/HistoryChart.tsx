/**
 * HistoryChart — обёртка над lightweight-charts v5.
 *
 * Возможности:
 *  • колёсико мыши — zoom с фокусом на курсоре
 *  • drag — pan влево/вправо
 *  • crosshair с тултипом
 *  • min_value/max_value — полоса диапазона (для 1min/1hour агрегатов)
 *  • onViewportChange — callback для progressive loading (debounced)
 *  • ref.fitContent() — вписать все данные по оси X (сброс zoom)
 *
 * Логика fitContent vs userZoomed:
 *  • После смены диапазона (снаружи вызывают fitContent()) → userZoomedRef сбрасывается,
 *    следующий setData автоматически вписывает новые данные.
 *  • Если пользователь вручную покрутил граф → userZoomedRef=true → setData не трогает zoom.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  TickMarkType,
  AreaSeries,
  LineSeries,
} from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time, AutoscaleInfo } from "lightweight-charts";

// ── Московское время ─────────────────────────────────────────────────────────
const MSK = "Europe/Moscow";

/** Форматирует Unix-секунды → строка в МСК */
function mskFmt(unixSec: number, opts: Intl.DateTimeFormatOptions): string {
  return new Date(unixSec * 1000).toLocaleString("ru-RU", { timeZone: MSK, ...opts });
}

/** Форматтер меток оси X (tick marks) в МСК */
function mskTickMarkFormatter(time: number, type: TickMarkType): string {
  switch (type) {
    case TickMarkType.Year:
      return mskFmt(time, { year: "numeric" });
    case TickMarkType.Month:
      return mskFmt(time, { month: "short", year: "2-digit" });
    case TickMarkType.DayOfMonth:
      return mskFmt(time, { day: "numeric", month: "short" });
    case TickMarkType.Time:
      return mskFmt(time, { hour: "2-digit", minute: "2-digit" });
    case TickMarkType.TimeWithSeconds:
      return mskFmt(time, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    default:
      return mskFmt(time, { hour: "2-digit", minute: "2-digit" });
  }
}

/** Форматтер crosshair-подписи времени в МСК */
function mskTimeFormatter(time: number): string {
  return mskFmt(time, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export interface ChartPoint {
  ts: number;       // epoch ms
  value: number;
  min_value?: number | null;
  max_value?: number | null;
}

export interface HistoryChartHandle {
  /** Сбросить ручной зум и вписать весь ряд данных по оси времени */
  fitContent(): void;
}

interface HistoryChartProps {
  data: ChartPoint[];
  label?: string;
  color?: string;
  isFetching?: boolean;
  /** Вызывается (debounced) при изменении viewport — для progressive loading */
  onViewportChange?: (startMs: number, endMs: number) => void;
}

const CHART_HEIGHT = 380;
const VIEWPORT_DEBOUNCE_MS = 700;
/** После fitContent() глушим onViewportChange на это время */
const FIT_SUPPRESS_MS = 800;

export const HistoryChart = forwardRef<HistoryChartHandle, HistoryChartProps>(
  function HistoryChart({ data, color = "#22c55e", isFetching = false, onViewportChange }, ref) {
    const containerRef    = useRef<HTMLDivElement>(null);
    const chartRef        = useRef<IChartApi | null>(null);
    const seriesRef       = useRef<ISeriesApi<"Area"> | null>(null);
    const bandHighRef     = useRef<ISeriesApi<"Line"> | null>(null);
    const bandLowRef      = useRef<ISeriesApi<"Line"> | null>(null);
    const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suppressVpRef   = useRef(false);  // глушим onViewportChange во время fitContent
    /** true = пользователь вручную покрутил граф; setData не вызывает fitContent */
    const userZoomedRef   = useRef(false);
    // Актуальные данные и цвет — держим в ref для init-эффекта (React StrictMode)
    const latestDataRef   = useRef(data);
    const latestColorRef  = useRef(color);
    latestDataRef.current  = data;
    latestColorRef.current = color;
    // Актуальный callback — ref чтобы не перепривязывать обработчик при каждом рендере
    const onVpChangeRef   = useRef(onViewportChange);
    onVpChangeRef.current  = onViewportChange;

    // ── Императивный хэндл ───────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      fitContent() {
        if (!chartRef.current) return;
        userZoomedRef.current  = false;   // сбросить признак ручного зума
        suppressVpRef.current  = true;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        chartRef.current.timeScale().fitContent();
        debounceRef.current = setTimeout(() => {
          suppressVpRef.current = false;
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
          tickMarkFormatter: mskTickMarkFormatter,
        },
        localization: {
          timeFormatter: mskTimeFormatter,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale:  { mouseWheel: true, pinch: true },
      });

      // Основная серия (Area) — v5 API
      const c = latestColorRef.current;
      const series = chart.addSeries(AreaSeries, {
        lineColor:   c,
        topColor:    c + "33",
        bottomColor: c + "00",
        lineWidth: 1,
        priceFormat: { type: "price", precision: 1, minMove: 0.1 },
        // Y-ось всегда от 0 (нагрузка не бывает ниже нуля)
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
          const res = original();
          if (!res) return res;
          return {
            priceRange: { minValue: 0, maxValue: res.priceRange.maxValue },
            margins: res.margins,
          };
        },
      });

      // Полосы min/max для агрегированных данных
      const bandHigh = chart.addSeries(LineSeries, {
        color: c + "55",
        lineWidth: 1,
        lineStyle: 2, // dashed
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      const bandLow = chart.addSeries(LineSeries, {
        color: c + "55",
        lineWidth: 1,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });

      chartRef.current    = chart;
      seriesRef.current   = series;
      bandHighRef.current = bandHigh;
      bandLowRef.current  = bandLow;

      // Применяем данные, которые уже есть на момент (пере)маунта.
      // Критично для React StrictMode: при двойном маунте data-эффект
      // не перезапускается, поэтому устанавливаем данные здесь явно.
      const initialData = latestDataRef.current;
      if (initialData.length) {
        series.setData(
          initialData.map((p) => ({ time: (p.ts / 1000) as Time, value: p.value }))
        );
        const hasBand = initialData.some(
          (p) => p.min_value != null && p.max_value != null && p.min_value !== p.max_value
        );
        if (hasBand) {
          bandHigh.setData(initialData.map((p) => ({ time: (p.ts / 1000) as Time, value: p.max_value ?? p.value })));
          bandLow.setData(initialData.map((p) => ({ time: (p.ts / 1000) as Time, value: p.min_value ?? p.value })));
        }
        chart.timeScale().fitContent();
      }

      // Resize observer
      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      ro.observe(containerRef.current);

      return () => {
        ro.disconnect();
        chart.remove();
        chartRef.current    = null;
        seriesRef.current   = null;
        bandHighRef.current = null;
        bandLowRef.current  = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Подписка на изменение viewport ───────────────────────────────────────
    // Всегда подписываемся (даже без onViewportChange) — нужно для userZoomedRef.
    // Callback передаётся через ref чтобы не перепривязывать обработчик.
    useEffect(() => {
      if (!chartRef.current) return;
      const timeScale = chartRef.current.timeScale();

      const handler = () => {
        if (suppressVpRef.current) return;
        userZoomedRef.current = true;   // пользователь вручную двигал граф
        const cb = onVpChangeRef.current;
        if (!cb) return;
        const range = timeScale.getVisibleRange();
        if (!range) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (suppressVpRef.current) return;
          cb(
            (range.from as number) * 1000,
            (range.to   as number) * 1000,
          );
        }, VIEWPORT_DEBOUNCE_MS);
      };

      timeScale.subscribeVisibleTimeRangeChange(handler);
      return () => {
        timeScale.unsubscribeVisibleTimeRangeChange(handler);
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // mount-only — onViewportChange читается через ref

    // ── Обновление данных ────────────────────────────────────────────────────
    useEffect(() => {
      if (!seriesRef.current || !bandHighRef.current || !bandLowRef.current) return;

      if (!data.length) {
        seriesRef.current.setData([]);
        bandHighRef.current.setData([]);
        bandLowRef.current.setData([]);
        return;
      }

      seriesRef.current.setData(
        data.map((p) => ({ time: (p.ts / 1000) as Time, value: p.value }))
      );

      const hasBand = data.some(
        (p) => p.min_value != null && p.max_value != null && p.min_value !== p.max_value
      );

      if (hasBand) {
        bandHighRef.current.setData(
          data.map((p) => ({ time: (p.ts / 1000) as Time, value: p.max_value ?? p.value }))
        );
        bandLowRef.current.setData(
          data.map((p) => ({ time: (p.ts / 1000) as Time, value: p.min_value ?? p.value }))
        );
      } else {
        bandHighRef.current.setData([]);
        bandLowRef.current.setData([]);
      }

      // fitContent вызываем только если пользователь НЕ зумировал вручную.
      // Это предотвращает сброс zoom при live-обновлениях и при progressive loading.
      // userZoomedRef сбрасывается в fitContent() (вызывается при смене диапазона).
      if (!userZoomedRef.current) {
        chartRef.current?.timeScale().fitContent();
      }
    }, [data]);

    // ── Обновляем цвет при смене регистра ───────────────────────────────────
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

    return (
      <div className="relative rounded-xl overflow-hidden border border-border">
        {isFetching && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px] rounded-xl pointer-events-none">
            <span className="text-xs text-muted-foreground animate-pulse">загрузка…</span>
          </div>
        )}
        <div ref={containerRef} style={{ height: CHART_HEIGHT }} />
      </div>
    );
  }
);
