import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  createSeriesMarkers,
  AreaSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type LineWidth,
} from "lightweight-charts";
import { MIN_SPAN_MS } from "./constants";
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

/** Начало UTC-суток (00:00) для timestamp в ms */
function startOfDayUTC(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 86_400_000;

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
  const mainRef = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bandTopRef = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bandBotRef = useRef<ISeriesApi<any> | null>(null);

  // Плагин маркеров для raw точек
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  /** true → игнорируем события visibleTimeRangeChange (мы сами двигаем viewport) */
  const suppressRef = useRef(true);
  const prevDataRef = useRef<ChartPoint[] | null>(null);
  const appliedVpRef = useRef<ViewportRange>(viewport);

  // Источник последнего изменения viewport: "pan" | "programmatic"
  const vpSourceRef = useRef<"pan" | "programmatic">("programmatic");

  // Refs для колбэков — чтобы chart init effect не пересоздавался
  const onZoomRef = useRef(onZoom);
  const onPanRef = useRef(onPan);
  const colorRef = useRef(color);
  onZoomRef.current = onZoom;
  onPanRef.current = onPan;
  colorRef.current = color;

  // Для голубой полоски «будущее»
  const futureRef = useRef<HTMLDivElement>(null);
  // Для canvas суточных полос
  const dayBandsRef = useRef<HTMLCanvasElement>(null);
  // Таймер debounce пана
  const panTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ── Рисование суточных полос ────────────────────────────────────────── */
  const drawDayBands = useCallback(() => {
    const chart = chartRef.current;
    const canvas = dayBandsRef.current;
    const container = containerRef.current;
    if (!chart || !canvas || !container) return;

    const W = container.clientWidth;
    // Высота chart area (без timeScale ~28px)
    const H = container.clientHeight - 28;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const ts = chart.timeScale();
    const range = ts.getVisibleRange();
    if (!range) return;

    const fromMs = (range.from as number) * 1000;
    const toMs = (range.to as number) * 1000;

    // Находим начало первого видимого дня
    let dayStart = startOfDayUTC(fromMs);
    let dayIndex = 0;

    // Определяем чётность первого дня (по кол-ву дней от epoch)
    const epochDayNum = Math.floor(dayStart / DAY_MS);

    while (dayStart < toMs) {
      const dayEnd = dayStart + DAY_MS;
      const isOdd = (epochDayNum + dayIndex) % 2 === 1;

      if (isOdd) {
        const x1 = ts.timeToCoordinate((dayStart / 1000) as Time);
        const x2 = ts.timeToCoordinate((dayEnd / 1000) as Time);

        if (x1 != null && x2 != null) {
          const left = Math.max(0, x1);
          const right = Math.min(W, x2);
          if (right > left) {
            ctx.fillStyle = "rgba(148, 163, 184, 0.08)";
            ctx.fillRect(left, 0, right - left, H);
          }
        }
      }

      dayStart = dayEnd;
      dayIndex++;
    }
  }, []);

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
      // Pan встроенный (LWC делает плавно), zoom — наш кастомный
      handleScroll: true,
      handleScale: false,
    });

    // ── Band top (max) ─────────────────────────────────────────────
    const bandTop = chart.addSeries(AreaSeries, {
      lineWidth: 1 as LineWidth,
      lineColor: "transparent",
      topColor: hexToRgba("#22c55e", 0.08),
      bottomColor: "transparent",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // ── Band bottom (min) — перекрывает нижнюю часть bandTop ───────
    const bandBot = chart.addSeries(AreaSeries, {
      lineWidth: 1 as LineWidth,
      lineColor: "transparent",
      topColor: "rgba(0,0,0,0)",
      bottomColor: "transparent",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // ── Main area (avg + зелёная тень под графиком) ──────────────
    const main = chart.addSeries(AreaSeries, {
      lineColor: "#22c55e",
      lineWidth: 2,
      topColor: hexToRgba("#22c55e", 0.18),
      bottomColor: hexToRgba("#22c55e", 0.02),
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    chartRef.current = chart;
    mainRef.current = main;
    bandTopRef.current = bandTop;
    bandBotRef.current = bandBot;

    // ── Pan detection (от встроенного drag LWC) ────────────────────
    // Не боремся с LWC — он двигает график плавно сам.
    // Мы только отслеживаем куда пользователь ушёл для подгрузки данных.
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (suppressRef.current || !range) return;
      const from = (range.from as number) * 1000;
      const to = (range.to as number) * 1000;
      if (to - from < MIN_SPAN_MS) return;
      appliedVpRef.current = { from, to };

      // Debounce: не дёргаем React state на каждый кадр пана.
      // LWC сам рендерит плавно, а мы обновляем state только при паузе —
      // это триггерит подгрузку данных, но не мешает анимации.
      clearTimeout(panTimerRef.current);
      panTimerRef.current = setTimeout(() => {
        vpSourceRef.current = "pan";
        onPanRef.current({ from, to });
      }, 80);

      // Перерисовать оверлеи синхронно с паном
      drawDayBands();
      updateFutureStripe();
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
      vpSourceRef.current = "programmatic";
      onZoomRef.current(cursorMs, zoomIn);
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // ── ResizeObserver ──────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (el) {
        chart.applyOptions({ width: el.clientWidth });
        drawDayBands();
      }
    });
    ro.observe(el);

    return () => {
      clearTimeout(panTimerRef.current);
      el.removeEventListener("mousedown", enable);
      el.removeEventListener("touchstart", enable);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
      markersRef.current?.detach();
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      bandTopRef.current = null;
      bandBotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Обновление цвета серий ────────────────────────────────────────────── */
  useEffect(() => {
    mainRef.current?.applyOptions({
      lineColor: color,
      topColor: hexToRgba(color, 0.18),
      bottomColor: hexToRgba(color, 0.02),
    });
    bandTopRef.current?.applyOptions({ topColor: hexToRgba(color, 0.08) });
  }, [color]);

  /* ── Загрузка / обновление данных ──────────────────────────────────────── */
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    const bandTop = bandTopRef.current;
    const bandBot = bandBotRef.current;
    if (!chart || !main || data === prevDataRef.current) return;
    prevDataRef.current = data;

    // Main area (avg)
    const lwMain = data.map((p) =>
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

    // Определяем: raw данные? (sampleCount === 1 или отсутствует у большинства)
    const rawPoints = data.filter(
      (p) => p.value !== null && (p.sampleCount == null || p.sampleCount <= 1),
    );
    const isRaw = rawPoints.length > data.filter((p) => p.value !== null).length * 0.5;

    // Применяем данные и восстанавливаем viewport без мерцания
    suppressRef.current = true;
    main.setData(lwMain);
    bandTop?.setData(topData);
    bandBot?.setData(botData);

    // Точки на raw данных — маркеры на каждой реальной точке
    if (isRaw && rawPoints.length <= 2000) {
      const markers = rawPoints.map((p) => ({
        time: (p.ts / 1000) as Time,
        position: "inBar" as const,
        color: colorRef.current,
        shape: "circle" as const,
        size: 0.2,
      }));
      if (markersRef.current) {
        markersRef.current.setMarkers(markers);
      } else {
        markersRef.current = createSeriesMarkers(main, markers);
      }
    } else if (markersRef.current) {
      markersRef.current.setMarkers([]);
    }

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
      requestAnimationFrame(() => {
        suppressRef.current = false;
        drawDayBands();
        updateFutureStripe();
      });
    });
  }, [data, drawDayBands]);

  /* ── Viewport из engine (zoom, refresh, начальная загрузка) ─────────────── */
  useEffect(() => {
    appliedVpRef.current = viewport;

    // Если viewport обновился от пана — НЕ трогаем chart, LWC уже показывает
    // правильную позицию. Дёргать setVisibleRange во время drag = рывки.
    if (vpSourceRef.current === "pan") {
      vpSourceRef.current = "programmatic"; // сбрасываем флаг
      return;
    }

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
        drawDayBands();
        updateFutureStripe();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  /* ── Голубая полоска «будущее» ──────────────────────────────────────────── */
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

        {/* Canvas для суточных полос — поверх графика, но не блокирует клики */}
        <canvas
          ref={dayBandsRef}
          className="absolute top-0 left-0 pointer-events-none"
          style={{ zIndex: 5 }}
        />

        {/* Голубая полоска «будущее» */}
        <div
          ref={futureRef}
          className="absolute top-0 pointer-events-none z-10"
          style={{
            display: "none",
            bottom: "28px",
            background: "rgba(59, 130, 246, 0.06)",
            borderLeft: "1px dashed rgba(59, 130, 246, 0.25)",
          }}
        />
      </div>
    </div>
  );
}
