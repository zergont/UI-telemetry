import { useEffect, useRef, useCallback, useState } from "react";
import {
  createChart,
  LineSeries,
  AreaSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { FUTURE_PAD_MS, MIN_SPAN_MS } from "./constants";
import type { ChartPoint, ViewportRange } from "./types";

/* ── Props ──────────────────────────────────────────────────────────────── */

interface HistoryChartProps {
  data: ChartPoint[];
  label: string;
  unit: string;
  color: string;
  viewport: ViewportRange;
  isLoading: boolean;
  onZoom: (cursorTimeMs: number, zoomIn: boolean) => void;
  onPan: (vp: ViewportRange) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function HistoryChart({
  data,
  label,
  unit,
  color,
  viewport,
  isLoading,
  onZoom,
  onPan,
}: HistoryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineRef = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bandTopRef = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bandBotRef = useRef<ISeriesApi<any> | null>(null);

  /** true → игнорируем события visibleTimeRangeChange (мы сами двигаем viewport) */
  const suppressRef = useRef(true);
  const prevDataRef = useRef<ChartPoint[] | null>(null);
  const appliedVpRef = useRef<ViewportRange>(viewport);

  // Refs для колбэков — чтобы chart init effect не пересоздавался
  const onZoomRef = useRef(onZoom);
  const onPanRef = useRef(onPan);
  onZoomRef.current = onZoom;
  onPanRef.current = onPan;

  // Для голубой полоски «будущее»
  const futureRef = useRef<HTMLDivElement>(null);

  /* ── Создание графика (один раз) ───────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.06)" },
        horzLines: { color: "rgba(148,163,184,0.06)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelVisible: true },
        horzLine: { labelVisible: true },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        lockVisibleTimeRangeOnResize: true,
      },
      // Pan встроенный, zoom — наш кастомный
      handleScroll: true,
      handleScale: false,
    });

    // ── Band top (max) ─────────────────────────────────────────────
    const bandTop = chart.addSeries(AreaSeries, {
      lineWidth: 0,
      lineColor: "transparent",
      topColor: hexToRgba("#22c55e", 0.10),
      bottomColor: "transparent",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // ── Band bottom (min) — перекрывает нижнюю часть bandTop ───────
    const bandBot = chart.addSeries(AreaSeries, {
      lineWidth: 0,
      lineColor: "transparent",
      topColor: "rgba(0,0,0,0)",
      bottomColor: "transparent",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // ── Main line (avg) ────────────────────────────────────────────
    const line = chart.addSeries(LineSeries, {
      color: "#22c55e",
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    chartRef.current = chart;
    lineRef.current = line;
    bandTopRef.current = bandTop;
    bandBotRef.current = bandBot;

    // ── Pan detection (от встроенного drag LWC) ────────────────────
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (suppressRef.current || !range) return;
      const from = (range.from as number) * 1000;
      const to = (range.to as number) * 1000;
      if (to - from < MIN_SPAN_MS) return;
      appliedVpRef.current = { from, to };
      onPanRef.current({ from, to });
    });

    // При mousedown/touchstart — перестаём подавлять события
    const enable = () => { suppressRef.current = false; };
    const el = containerRef.current;
    el.addEventListener("mousedown", enable);
    el.addEventListener("touchstart", enable, { passive: true });

    // ── Кастомный zoom (wheel → zoomAtCursor) ──────────────────────
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ts = chart.timeScale();
      const cursorTime = ts.coordinateToTime(x);
      if (cursorTime == null) return;
      const cursorMs = (cursorTime as number) * 1000;
      const zoomIn = e.deltaY < 0;
      suppressRef.current = true;
      onZoomRef.current(cursorMs, zoomIn);
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // ── ResizeObserver ──────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      el.removeEventListener("mousedown", enable);
      el.removeEventListener("touchstart", enable);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      lineRef.current = null;
      bandTopRef.current = null;
      bandBotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Обновление цвета серий ────────────────────────────────────────────── */
  useEffect(() => {
    lineRef.current?.applyOptions({ color });
    bandTopRef.current?.applyOptions({ topColor: hexToRgba(color, 0.10) });
  }, [color]);

  /* ── Загрузка / обновление данных ──────────────────────────────────────── */
  useEffect(() => {
    const chart = chartRef.current;
    const line = lineRef.current;
    const bandTop = bandTopRef.current;
    const bandBot = bandBotRef.current;
    if (!chart || !line || data === prevDataRef.current) return;
    prevDataRef.current = data;

    // Main line
    const lwLine = data.map((p) =>
      p.value === null
        ? { time: (p.ts / 1000) as Time }
        : { time: (p.ts / 1000) as Time, value: p.value },
    );

    // Min/Max band (только для агрегированных данных)
    const hasAgg = data.some(
      (p) =>
        p.value !== null &&
        p.sampleCount != null &&
        p.sampleCount > 1 &&
        p.minValue != null &&
        p.maxValue != null &&
        p.minValue !== p.maxValue,
    );

    const topData = hasAgg
      ? data
          .filter((p) => p.value !== null)
          .map((p) => ({
            time: (p.ts / 1000) as Time,
            value:
              p.maxValue != null && p.sampleCount != null && p.sampleCount > 1
                ? p.maxValue
                : p.value!,
          }))
      : [];

    const botData = hasAgg
      ? data
          .filter((p) => p.value !== null)
          .map((p) => ({
            time: (p.ts / 1000) as Time,
            value:
              p.minValue != null && p.sampleCount != null && p.sampleCount > 1
                ? p.minValue
                : p.value!,
          }))
      : [];

    // Применяем данные и восстанавливаем viewport без мерцания
    suppressRef.current = true;
    line.setData(lwLine);
    bandTop?.setData(topData);
    bandBot?.setData(botData);

    // Восстановить viewport в следующем кадре (после layout LWC)
    const vp = appliedVpRef.current;
    requestAnimationFrame(() => {
      if (!chartRef.current) return;
      suppressRef.current = true;
      try {
        chartRef.current.timeScale().setVisibleRange({
          from: (vp.from / 1000) as Time,
          to: (vp.to / 1000) as Time,
        });
      } catch { /* timeScale not ready */ }
      // Задержка перед снятием suppress — ждём пока LWC отработает
      requestAnimationFrame(() => {
        suppressRef.current = false;
      });
    });
  }, [data]);

  /* ── Viewport из engine (zoom, refresh, начальная загрузка) ─────────────── */
  useEffect(() => {
    appliedVpRef.current = viewport;
    const chart = chartRef.current;
    if (!chart) return;

    requestAnimationFrame(() => {
      if (!chartRef.current) return;
      suppressRef.current = true;
      try {
        chartRef.current.timeScale().setVisibleRange({
          from: (viewport.from / 1000) as Time,
          to: (viewport.to / 1000) as Time,
        });
      } catch { /* not ready */ }
      requestAnimationFrame(() => {
        suppressRef.current = false;
        updateFutureStripe();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  /* ── Голубая полоска «будущее» ──────────────────────────────────────────── */
  const updateFutureStripe = useCallback(() => {
    const chart = chartRef.current;
    const el = futureRef.current;
    const container = containerRef.current;
    if (!chart || !el || !container) return;

    const now = Date.now();
    const nowSec = (now / 1000) as Time;
    const coord = chart.timeScale().timeToCoordinate(nowSec);
    const containerW = container.clientWidth;

    if (coord != null && coord < containerW - 5) {
      const left = Math.max(0, coord);
      el.style.display = "block";
      el.style.left = `${left}px`;
      el.style.width = `${containerW - left}px`;
    } else {
      el.style.display = "none";
    }
  }, []);

  // Обновлять полоску при скролле
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const unsub = chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      updateFutureStripe();
    });
    return () => unsub();
  }, [updateFutureStripe]);

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="relative w-full">
      {/* Loading overlay — тонкая полоска сверху, не блокирует взаимодействие */}
      {isLoading && (
        <div className="absolute top-0 left-0 right-0 z-20 h-0.5 overflow-hidden rounded-t-xl">
          <div className="h-full w-1/3 animate-[slide_1s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
      )}

      {/* Заголовок */}
      <div className="text-xs text-muted-foreground mb-1">
        {label} <span className="text-muted-foreground/50">({unit})</span>
      </div>

      {/* Chart container */}
      <div className="relative">
        <div ref={containerRef} className="h-[400px] w-full rounded-xl overflow-hidden" />

        {/* Голубая полоска «будущее» */}
        <div
          ref={futureRef}
          className="absolute top-0 pointer-events-none"
          style={{
            display: "none",
            bottom: "23px", // высота timeScale LWC
            background: "rgba(59, 130, 246, 0.06)",
            borderLeft: "1px dashed rgba(59, 130, 246, 0.25)",
          }}
        />
      </div>
    </div>
  );
}
