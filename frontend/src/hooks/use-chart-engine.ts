import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import {
  DEFAULT_SPAN_MS,
  FETCH_DEBOUNCE_MS,
  FUTURE_PAD_MS,
  LOAD_TRIGGER,
  MIN_SPAN_MS,
  PREFETCH_SCREENS,
  ZOOM_SPEED,
} from "@/components/equipment/history/constants";
import {
  buildChartData,
  calcTargetPoints,
  clamp,
  isFiniteNumber,
  mergePoints,
  parseIsoToMs,
  zoomBucket,
} from "@/components/equipment/history/utils";
import type {
  ChartPoint,
  GapZone,
  HistoryResponse,
  ViewportRange,
} from "@/components/equipment/history/types";

/* ── Types ──────────────────────────────────────────────────────────────── */

/** Gap в миллисекундах (конвертирован из ISO) */
export interface GapMs {
  from: number;  // Unix ms
  to: number | null;  // null = ongoing
}

interface DataCache {
  points: ChartPoint[];
  gaps: GapMs[];
  loadedFrom: number;
  loadedTo: number;
  bucket: number;        // zoomBucket при котором загружены данные
}

interface UseChartEngineOpts {
  routerSn: string;
  equipType: string;
  panelId: string;
  addr: number;
}

/** Интервал автосдвига viewport в live-режиме (мс) */
const LIVE_SHIFT_INTERVAL_MS = 60_000;

interface UseChartEngineResult {
  /** Текущий видимый диапазон (ms) */
  viewport: ViewportRange;
  /** Все загруженные точки (кумулятивно) */
  data: ChartPoint[];
  /** Gap-зоны (разрывы связи) */
  gaps: GapMs[];
  /** Загрузка в процессе */
  isLoading: boolean;
  /** Самая ранняя точка данных в БД (ms) */
  firstDataAt: number | null;
  /** Live-режим: данные дорисовываются в реальном времени */
  isLive: boolean;

  /** Zoom к курсору. zoomIn=true — приближение */
  zoomAtCursor: (cursorTimeMs: number, zoomIn: boolean) => void;
  /** Установить viewport (вызывается при pan из графика) */
  setViewport: (vp: ViewportRange) => void;
  /** Сброс к начальному виду: последние 4 часа, очистка кэша, включение live */
  refresh: () => void;
}

/* ── Fetch helper ───────────────────────────────────────────────────────── */

function parseGaps(gaps: GapZone[]): GapMs[] {
  return gaps.map((g) => ({
    from: parseIsoToMs(g.gap_start),
    to: g.gap_end ? parseIsoToMs(g.gap_end) : null,
  }));
}

async function fetchRange(
  routerSn: string,
  equipType: string,
  panelId: string,
  addr: number,
  from: number,
  to: number,
  points: number,
  signal?: AbortSignal,
): Promise<{ points: ChartPoint[]; gaps: GapMs[]; firstDataAt: number | null } | null> {
  const params = new URLSearchParams({
    router_sn: routerSn,
    equip_type: equipType,
    panel_id: panelId,
    addr: String(addr),
    start: new Date(from).toISOString(),
    end: new Date(Math.min(to, Date.now() + FUTURE_PAD_MS)).toISOString(),
    points: String(Math.min(points, 20000)),
  });

  try {
    const resp = await apiFetch<HistoryResponse>(`/api/history?${params}`, { signal });
    const pts = buildChartData(resp.points);
    const gaps = parseGaps(resp.gaps ?? []);
    const fda = resp.first_data_at ? parseIsoToMs(resp.first_data_at) : null;
    return { points: pts, gaps, firstDataAt: isFiniteNumber(fda) ? fda : null };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    console.error("[chart-engine] fetch error:", e);
    return null;
  }
}

/* ── Hook ───────────────────────────────────────────────────────────────── */

/** Объединить два списка gap'ов без дубликатов (по gap_start) */
function mergeGaps(a: GapMs[], b: GapMs[]): GapMs[] {
  const map = new Map<number, GapMs>();
  for (const g of a) map.set(g.from, g);
  for (const g of b) map.set(g.from, g);
  return Array.from(map.values()).sort((x, y) => x.from - y.from);
}

function makeDefaultViewport(): ViewportRange {
  const now = Date.now();
  return { from: now - DEFAULT_SPAN_MS, to: now + FUTURE_PAD_MS };
}

export function useChartEngine({
  routerSn,
  equipType,
  panelId,
  addr,
}: UseChartEngineOpts): UseChartEngineResult {
  /* ── state ─────────────────────────────────────────────────────────────── */
  const [viewport, setViewportRaw] = useState<ViewportRange>(makeDefaultViewport);
  const [data, setData] = useState<ChartPoint[]>([]);
  const [gaps, setGaps] = useState<GapMs[]>([]);
  const [firstDataAt, setFirstDataAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(true);

  const cacheRef = useRef<DataCache | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const viewportRef = useRef(viewport);
  const firstDataAtRef = useRef(firstDataAt);
  const isLiveRef = useRef(isLive);

  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { firstDataAtRef.current = firstDataAt; }, [firstDataAt]);
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);

  // Сброс кэша при смене параметра (другой регистр, другое оборудование)
  const paramKey = `${routerSn}/${equipType}/${panelId}/${addr}`;
  const prevParamKey = useRef(paramKey);
  useEffect(() => {
    if (prevParamKey.current !== paramKey) {
      prevParamKey.current = paramKey;
      cacheRef.current = null;
      setData([]);
      setGaps([]);
      setFirstDataAt(null);
      setIsLoading(true);
      setViewportRaw(makeDefaultViewport());
    }
  }, [paramKey]);

  /* ── data loader ───────────────────────────────────────────────────────── */
  useEffect(() => {
    clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const vp = viewportRef.current;
      const span = vp.to - vp.from;
      const bucket = zoomBucket(span);
      const cache = cacheRef.current;
      const needsFullRefetch = !cache || cache.bucket !== bucket;

      // Отменяем предыдущий запрос
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (needsFullRefetch) {
        // ── Полная перезагрузка (первый раз или смена зума) ──
        const sideMargin = span * ((PREFETCH_SCREENS - 1) / 2);
        const fetchFrom = vp.from - sideMargin;
        const fetchTo = vp.to + sideMargin;
        const pts = calcTargetPoints(span) * PREFETCH_SCREENS;

        setIsLoading(true);
        fetchRange(routerSn, equipType, panelId, addr, fetchFrom, fetchTo, pts, ac.signal)
          .then((res) => {
            if (!res || ac.signal.aborted) return;
            cacheRef.current = { points: res.points, gaps: res.gaps, loadedFrom: fetchFrom, loadedTo: fetchTo, bucket };
            setData(res.points);
            setGaps(res.gaps);
            if (res.firstDataAt != null) setFirstDataAt(res.firstDataAt);
            setIsLoading(false);
          });
      } else {
        // ── Инкрементальная подгрузка (пан в пределах того же зума) ──
        const leftBuf = vp.from - cache.loadedFrom;
        const rightBuf = cache.loadedTo - vp.to;
        const threshold = span * LOAD_TRIGGER;
        const ptsPerScreen = calcTargetPoints(span);

        let promise: Promise<void> = Promise.resolve();

        if (leftBuf < threshold) {
          // Нужно догрузить слева
          const edgeTo = cache.loadedFrom;
          const edgeFrom = edgeTo - span * 1.5;
          const edgePts = Math.round(ptsPerScreen * 1.5);
          setIsLoading(true);
          promise = fetchRange(routerSn, equipType, panelId, addr, edgeFrom, edgeTo, edgePts, ac.signal)
            .then((res) => {
              if (!res || ac.signal.aborted) return;
              const merged = mergePoints(res.points, cache.points);
              cache.points = merged;
              cache.gaps = mergeGaps(res.gaps, cache.gaps);
              cache.loadedFrom = edgeFrom;
              if (res.firstDataAt != null) setFirstDataAt(res.firstDataAt);
              setData(merged);
              setGaps(cache.gaps);
            });
        }

        if (rightBuf < threshold) {
          // Нужно догрузить справа
          const edgeFrom = cache.loadedTo;
          const edgeTo = edgeFrom + span * 1.5;
          const edgePts = Math.round(ptsPerScreen * 1.5);
          promise = promise.then(() => {
            if (ac.signal.aborted) return;
            return fetchRange(routerSn, equipType, panelId, addr, edgeFrom, edgeTo, edgePts, ac.signal)
              .then((res) => {
                if (!res || ac.signal.aborted) return;
                const merged = mergePoints(cache.points, res.points);
                cache.points = merged;
                cache.gaps = mergeGaps(cache.gaps, res.gaps);
                cache.loadedTo = edgeTo;
                setData(merged);
                setGaps(cache.gaps);
              });
          });
        }

        promise.then(() => { if (!ac.signal.aborted) setIsLoading(false); });
      }
    }, FETCH_DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, routerSn, equipType, panelId, addr]);

  /* ── zoom к курсору ────────────────────────────────────────────────────── */
  const zoomAtCursor = useCallback((cursorTimeMs: number, zoomIn: boolean) => {
    setIsLive(false);
    setViewportRaw((prev) => {
      const span = prev.to - prev.from;
      const factor = zoomIn ? 1 - ZOOM_SPEED : 1 + ZOOM_SPEED;
      const fda = firstDataAtRef.current;
      const now = Date.now();

      // Максимальный span: от первой точки данных до now + буфер
      const maxSpan = fda != null
        ? (now + FUTURE_PAD_MS) - fda
        : span * 10; // если first_data_at не известен — не ограничиваем жёстко

      const newSpan = clamp(span * factor, MIN_SPAN_MS, maxSpan);

      // Пропорция курсора внутри viewport
      const ratio = clamp((cursorTimeMs - prev.from) / span, 0, 1);

      let newFrom = cursorTimeMs - ratio * newSpan;
      let newTo = newFrom + newSpan;

      // П.4: если зум назад упёрся в будущее — привязываем правый край
      if (newTo > now + FUTURE_PAD_MS) {
        newTo = now + FUTURE_PAD_MS;
        newFrom = newTo - newSpan;
      }

      // П.7: если отъехали дальше first_data_at — не уходим в пустоту
      if (fda != null && newFrom < fda - newSpan * 0.1) {
        newFrom = fda - newSpan * 0.1;
        newTo = newFrom + newSpan;
      }

      return { from: newFrom, to: newTo };
    });
  }, []);

  /* ── setViewport (от drag/pan в графике) ──────────────────────────────── */
  const setViewport = useCallback((vp: ViewportRange) => {
    if (!isFiniteNumber(vp.from) || !isFiniteNumber(vp.to) || vp.to <= vp.from) return;
    setIsLive(false);

    setViewportRaw((prev) => {
      // Пан НЕ меняет масштаб — сохраняем span предыдущего viewport.
      // Графическая библиотека может слегка менять span при пане,
      // что вызывает прыжки зума. Фиксируем span — меняется только позиция.
      const prevSpan = prev.to - prev.from;
      let newFrom = vp.from;
      let newTo = newFrom + prevSpan;

      // Ограничение пана в будущее: правый край не дальше now + FUTURE_PAD_MS
      const maxTo = Date.now() + FUTURE_PAD_MS;
      if (newTo > maxTo) {
        newTo = maxTo;
        newFrom = newTo - prevSpan;
      }

      // Ограничение пана в прошлое: не дальше firstDataAt - 30% видимой области.
      const fda = firstDataAtRef.current;
      if (fda != null) {
        const minFrom = fda - prevSpan * 0.3;
        if (newFrom < minFrom) {
          newFrom = minFrom;
          newTo = newFrom + prevSpan;
        }
      }

      return { from: newFrom, to: newTo };
    });
  }, []);

  /* ── refresh / reset ───────────────────────────────────────────────────── */
  const refresh = useCallback(() => {
    abortRef.current?.abort();
    cacheRef.current = null;
    setData([]);
    setGaps([]);
    setFirstDataAt(null);
    setIsLoading(true);
    setIsLive(true);
    setViewportRaw(makeDefaultViewport());
  }, []);

  /* ── Live: безопасный парсинг timestamp ──────────────────────────────── */
  function parseLiveTs(raw: string | null | undefined): number {
    if (!raw) return Date.now();
    // parseIsoToMs добавляет "Z" если нет — единообразно с history
    try {
      const ms = parseIsoToMs(raw);
      return isFiniteNumber(ms) ? ms : Date.now();
    } catch {
      return Date.now();
    }
  }

  /* ── Live: подписка на телеметрию из WS (императивная) ────────────────── */
  const lastLiveTsRef = useRef<number>(0);
  const liveAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isLive) return;

    const key = makeEquipKey(routerSn, equipType, Number(panelId));

    const unsub = useTelemetryStore.subscribe((state) => {
      if (!isLiveRef.current) return;

      const reg = state.registers.get(key)?.get(addr);
      if (!reg || reg.value == null) return;

      const ts = parseLiveTs(reg.ts);
      if (ts <= lastLiveTsRef.current) return;
      lastLiveTsRef.current = ts;

      const newPt: ChartPoint = { ts, value: reg.value, sampleCount: 1 };

      // Добавляем точку в кэш
      const cache = cacheRef.current;
      if (cache) {
        cache.points = mergePoints(cache.points, [newPt]);
        cache.loadedTo = Math.max(cache.loadedTo, ts + 1000);
      }

      setData((prev) => mergePoints(prev, [newPt]));
    });

    return unsub;
  }, [isLive, routerSn, equipType, panelId, addr]);

  /* ── Live: авто-сдвиг viewport + свежий fetch каждую минуту ─────────── */
  useEffect(() => {
    if (!isLive) return;

    const timer = setInterval(() => {
      if (!isLiveRef.current) return;

      const now = Date.now();
      const cache = cacheRef.current;

      // 1. Сдвигаем viewport (не через setViewportRaw чтобы не триггерить data-loader)
      //    Вместо этого напрямую обновляем viewportRef и state одним действием
      //    с пометкой что это live-сдвиг.
      const newVp: ViewportRange = (() => {
        const prev = viewportRef.current;
        const span = prev.to - prev.from;
        const newTo = now + FUTURE_PAD_MS;
        return { from: newTo - span, to: newTo };
      })();

      // 2. Свежий fetch за последние 5 минут — страховка для точек,
      //    которые бэкенд уже сохранил в БД, но WS не доставил
      liveAbortRef.current?.abort();
      const ac = new AbortController();
      liveAbortRef.current = ac;

      const fetchFrom = now - 5 * 60_000;
      const fetchTo = now + FUTURE_PAD_MS;
      fetchRange(routerSn, equipType, panelId, addr, fetchFrom, fetchTo, 500, ac.signal)
        .then((res) => {
          if (!res || ac.signal.aborted || !isLiveRef.current) return;
          if (cache) {
            cache.points = mergePoints(cache.points, res.points);
            cache.loadedTo = Math.max(cache.loadedTo, fetchTo);
          }
          // Обновляем data из кэша (все live + свежие серверные точки)
          setData(cache ? cache.points : res.points);
        });

      // 3. Обновляем viewport state
      setViewportRaw(newVp);
    }, LIVE_SHIFT_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      liveAbortRef.current?.abort();
    };
  }, [isLive, routerSn, equipType, panelId, addr]);

  return { viewport, data, gaps, isLoading, firstDataAt, isLive, zoomAtCursor, setViewport, refresh };
}
