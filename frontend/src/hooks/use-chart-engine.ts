import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
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
  HistoryResponse,
  ViewportRange,
} from "@/components/equipment/history/types";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface DataCache {
  points: ChartPoint[];
  loadedFrom: number;
  loadedTo: number;
  bucket: number;        // zoomBucket при котором загружены данные
}

interface UseChartEngineOpts {
  routerSn: string;
  equipType: string;
  panelId: string;
  addr: number;
  minGapPoints?: number;
}

interface UseChartEngineResult {
  /** Текущий видимый диапазон (ms) */
  viewport: ViewportRange;
  /** Все загруженные точки (кумулятивно) */
  data: ChartPoint[];
  /** Загрузка в процессе */
  isLoading: boolean;
  /** Самая ранняя точка данных в БД (ms) */
  firstDataAt: number | null;

  /** Zoom к курсору. zoomIn=true — приближение */
  zoomAtCursor: (cursorTimeMs: number, zoomIn: boolean) => void;
  /** Установить viewport (вызывается при pan из LWC) */
  setViewport: (vp: ViewportRange) => void;
  /** Сброс к начальному виду: последние 4 часа, очистка кэша */
  refresh: () => void;
}

/* ── Fetch helper ───────────────────────────────────────────────────────── */

async function fetchRange(
  routerSn: string,
  equipType: string,
  panelId: string,
  addr: number,
  from: number,
  to: number,
  points: number,
  minGapPoints: number,
  signal?: AbortSignal,
): Promise<{ points: ChartPoint[]; firstDataAt: number | null } | null> {
  const params = new URLSearchParams({
    router_sn: routerSn,
    equip_type: equipType,
    panel_id: panelId,
    addr: String(addr),
    start: new Date(from).toISOString(),
    end: new Date(Math.min(to, Date.now() + FUTURE_PAD_MS)).toISOString(),
    points: String(Math.min(points, 20000)),
    min_gap_points: String(minGapPoints),
  });

  try {
    const resp = await apiFetch<HistoryResponse>(`/api/history?${params}`, { signal });
    const pts = buildChartData(resp.points, resp.gaps);
    const fda = resp.first_data_at ? parseIsoToMs(resp.first_data_at) : null;
    return { points: pts, firstDataAt: isFiniteNumber(fda) ? fda : null };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    console.error("[chart-engine] fetch error:", e);
    return null;
  }
}

/* ── Hook ───────────────────────────────────────────────────────────────── */

function makeDefaultViewport(): ViewportRange {
  const now = Date.now();
  return { from: now - DEFAULT_SPAN_MS, to: now + FUTURE_PAD_MS };
}

export function useChartEngine({
  routerSn,
  equipType,
  panelId,
  addr,
  minGapPoints = 3,
}: UseChartEngineOpts): UseChartEngineResult {
  /* ── state ─────────────────────────────────────────────────────────────── */
  const [viewport, setViewportRaw] = useState<ViewportRange>(makeDefaultViewport);
  const [data, setData] = useState<ChartPoint[]>([]);
  const [firstDataAt, setFirstDataAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const cacheRef = useRef<DataCache | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const viewportRef = useRef(viewport);
  const firstDataAtRef = useRef(firstDataAt);

  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { firstDataAtRef.current = firstDataAt; }, [firstDataAt]);

  // Сброс кэша при смене параметра (другой регистр, другое оборудование)
  const paramKey = `${routerSn}/${equipType}/${panelId}/${addr}`;
  const prevParamKey = useRef(paramKey);
  useEffect(() => {
    if (prevParamKey.current !== paramKey) {
      prevParamKey.current = paramKey;
      cacheRef.current = null;
      setData([]);
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
        fetchRange(routerSn, equipType, panelId, addr, fetchFrom, fetchTo, pts, minGapPoints, ac.signal)
          .then((res) => {
            if (!res || ac.signal.aborted) return;
            cacheRef.current = { points: res.points, loadedFrom: fetchFrom, loadedTo: fetchTo, bucket };
            setData(res.points);
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
          promise = fetchRange(routerSn, equipType, panelId, addr, edgeFrom, edgeTo, edgePts, minGapPoints, ac.signal)
            .then((res) => {
              if (!res || ac.signal.aborted) return;
              const merged = mergePoints(res.points, cache.points);
              cache.points = merged;
              cache.loadedFrom = edgeFrom;
              if (res.firstDataAt != null) setFirstDataAt(res.firstDataAt);
              setData(merged);
            });
        }

        if (rightBuf < threshold) {
          // Нужно догрузить справа
          const edgeFrom = cache.loadedTo;
          const edgeTo = edgeFrom + span * 1.5;
          const edgePts = Math.round(ptsPerScreen * 1.5);
          promise = promise.then(() => {
            if (ac.signal.aborted) return;
            return fetchRange(routerSn, equipType, panelId, addr, edgeFrom, edgeTo, edgePts, minGapPoints, ac.signal)
              .then((res) => {
                if (!res || ac.signal.aborted) return;
                const merged = mergePoints(cache.points, res.points);
                cache.points = merged;
                cache.loadedTo = edgeTo;
                setData(merged);
              });
          });
        }

        promise.then(() => { if (!ac.signal.aborted) setIsLoading(false); });
      }
    }, FETCH_DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, routerSn, equipType, panelId, addr, minGapPoints]);

  /* ── zoom к курсору ────────────────────────────────────────────────────── */
  const zoomAtCursor = useCallback((cursorTimeMs: number, zoomIn: boolean) => {
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

  /* ── setViewport (от drag/pan в LWC) ───────────────────────────────────── */
  const setViewport = useCallback((vp: ViewportRange) => {
    if (!isFiniteNumber(vp.from) || !isFiniteNumber(vp.to) || vp.to <= vp.from) return;
    const span = vp.to - vp.from;
    if (span < MIN_SPAN_MS) return;

    // Ограничение пана в прошлое: не дальше firstDataAt - 30% видимой области.
    // Это создаёт «мёртвую зону» — пользователь видит пустоту и понимает, что данных больше нет.
    const fda = firstDataAtRef.current;
    if (fda != null) {
      const minFrom = fda - span * 0.3;
      if (vp.from < minFrom) {
        vp = { from: minFrom, to: minFrom + span };
      }
    }

    setViewportRaw(vp);
  }, []);

  /* ── refresh / reset ───────────────────────────────────────────────────── */
  const refresh = useCallback(() => {
    abortRef.current?.abort();
    cacheRef.current = null;
    setData([]);
    setFirstDataAt(null);
    setIsLoading(true);
    setViewportRaw(makeDefaultViewport());
  }, []);

  return { viewport, data, isLoading, firstDataAt, zoomAtCursor, setViewport, refresh };
}
