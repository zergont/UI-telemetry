/**
 * HistoryChart — обёртка над lightweight-charts v5.
 *
 * Возможности:
 *  • колёсико мыши — zoom с фокусом на курсоре
 *  • drag — pan влево/вправо
 *  • crosshair с тултипом
 *  • min_value/max_value — полоса диапазона (для 1min/1hour агрегатов)
 *  • onViewportChange — callback для progressive loading
 */

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  AreaSeries,
  LineSeries,
} from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";

export interface ChartPoint {
  ts: number;       // epoch ms
  value: number;
  min_value?: number | null;
  max_value?: number | null;
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
const VIEWPORT_DEBOUNCE_MS = 400;

export function HistoryChart({
  data,
  color = "#22c55e",
  isFetching = false,
  onViewportChange,
}: HistoryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Area"> | null>(null);
  const bandHighRef  = useRef<ISeriesApi<"Line"> | null>(null);
  const bandLowRef   = useRef<ISeriesApi<"Line"> | null>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Инициализация графика (один раз) ─────────────────────────────────────
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
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { mouseWheel: true, pinch: true },
    });

    // Основная серия (Area) — v5 API
    const series = chart.addSeries(AreaSeries, {
      lineColor:   color,
      topColor:    color + "33",
      bottomColor: color + "00",
      lineWidth: 1,
      priceFormat: { type: "price", precision: 1, minMove: 0.1 },
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: 0, maxValue: undefined as unknown as number },
      }),
    });

    // Полосы min/max для агрегированных данных
    const bandHigh = chart.addSeries(LineSeries, {
      color: color + "55",
      lineWidth: 1,
      lineStyle: 2, // dashed
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    const bandLow = chart.addSeries(LineSeries, {
      color: color + "55",
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

  // ── Подписка на изменение viewport → progressive loading ─────────────────
  useEffect(() => {
    if (!chartRef.current || !onViewportChange) return;
    const timeScale = chartRef.current.timeScale();

    const handler = () => {
      const range = timeScale.getVisibleRange();
      if (!range) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onViewportChange(
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
  }, [onViewportChange]);

  // ── Обновление данных ─────────────────────────────────────────────────────
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
  }, [data]);

  // ── Обновляем цвет при смене регистра ────────────────────────────────────
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
