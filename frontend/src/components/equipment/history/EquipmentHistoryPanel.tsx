import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHistory } from "@/hooks/use-history";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import { useSettingsStore } from "@/stores/settings-store";
import { HistoryChart } from "@/components/equipment/HistoryChart";
import {
  HISTORY_FETCH_BUCKET_MS,
  LIVE_TICK_MS,
  QUERY_MARGIN_RATIO,
  RANGE_MS,
  REGISTER_OPTIONS,
} from "./constants";
import {
  alignViewportToLive,
  clampVisibleSpan,
  computeMaxVisibleSpan,
  getFutureBufferMs,
  getMatchingPreset,
  isFiniteNumber,
  interpolateToGrid,
  makeViewportFromCenter,
  sanitizeViewportRange,
} from "./utils";
import type {
  CameraMode,
  ChartPoint,
  HistoryRangeKey,
  ViewportChangeEvent,
  ViewportCommand,
  ViewportRange,
} from "./types";

interface EquipmentHistoryPanelProps {
  routerSn: string;
  equipType: string;
  panelId: string;
}

const DEFAULT_PRESET: HistoryRangeKey = "24h";

function createInitialViewport(nowMs: number): ViewportRange {
  return alignViewportToLive(
    RANGE_MS[DEFAULT_PRESET],
    nowMs,
    getFutureBufferMs(RANGE_MS[DEFAULT_PRESET]),
  );
}

export default function EquipmentHistoryPanel({
  routerSn,
  equipType,
  panelId,
}: EquipmentHistoryPanelProps) {
  const minGapPoints = useSettingsStore((s) => s.minGapPoints);
  const equipKey = makeEquipKey(routerSn, equipType, panelId);
  const liveRegs = useTelemetryStore((s) => s.registers.get(equipKey));

  const [initialNowMs] = useState(() => Date.now());
  const initialViewport = useMemo(() => createInitialViewport(initialNowMs), [initialNowMs]);

  const [selectedAddr, setSelectedAddr] = useState(40034);
  const [nowMs, setNowMs] = useState(initialNowMs);
  const [cameraMode, setCameraMode] = useState<CameraMode>("live");
  const [viewport, setViewport] = useState<ViewportRange>(initialViewport);
  const [fetchViewport, setFetchViewport] = useState<ViewportRange>(initialViewport);
  const [pendingRange, setPendingRange] = useState<ViewportCommand>({
    ...initialViewport,
    key: 0,
  });

  const commandKeyRef = useRef(0);

  const visibleSpanMs = viewport.to - viewport.from;
  const activePreset = useMemo(
    () => getMatchingPreset(visibleSpanMs),
    [visibleSpanMs],
  );
  const futureBufferMs = useMemo(
    () => getFutureBufferMs(visibleSpanMs),
    [visibleSpanMs],
  );

  const livePoint = useMemo<ChartPoint | null>(() => {
    const reg = liveRegs?.get(selectedAddr);
    if (!reg || reg.value == null) return null;
    if (reg.raw === 65535 || reg.raw === 32767) return null;
    if (reg.reason?.toUpperCase().includes("NA")) return null;
    const tsStr = reg.ts ?? reg.receivedAt;
    const ts = new Date(tsStr.endsWith("Z") ? tsStr : `${tsStr}Z`).getTime();
    return { ts, value: reg.value };
  }, [liveRegs, selectedAddr]);

  const issueViewportCommand = useCallback((nextViewport: ViewportRange) => {
    const safeViewport = sanitizeViewportRange(nextViewport, viewport);
    commandKeyRef.current += 1;
    setViewport(safeViewport);
    setPendingRange({ ...safeViewport, key: commandKeyRef.current });
  }, [viewport]);

  const queryBounds = useMemo(() => {
    const safeViewport = sanitizeViewportRange(fetchViewport, initialViewport);
    const safeSpanMs = clampVisibleSpan(safeViewport.to - safeViewport.from, null);
    const safeNowMs = isFiniteNumber(nowMs) ? nowMs : initialNowMs;
    const marginMs = safeSpanMs * QUERY_MARGIN_RATIO;
    const startMs = Math.max(0, safeViewport.from - marginMs);
    const unclampedEndMs = Math.max(startMs + 1_000, Math.min(safeNowMs, safeViewport.to + marginMs));
    const bucketedEndMs = Math.max(
      startMs + 1_000,
      Math.floor(unclampedEndMs / HISTORY_FETCH_BUCKET_MS) * HISTORY_FETCH_BUCKET_MS,
    );
    return {
      queryStart: new Date(startMs).toISOString(),
      queryEnd: new Date(bucketedEndMs).toISOString(),
    };
  }, [fetchViewport, initialNowMs, initialViewport, nowMs]);

  const targetPoints = useMemo(
    () => Math.min(20000, Math.max(2000, window.innerWidth * 4)),
    [],
  );

  const { data: historyResp, isLoading } = useHistory(
    routerSn,
    equipType,
    panelId,
    selectedAddr,
    queryBounds.queryStart,
    queryBounds.queryEnd,
    targetPoints,
    true,
    minGapPoints,
  );

  const firstDataAt = useMemo(() => {
    const raw = historyResp?.first_data_at;
    if (!raw) return null;
    const parsed = new Date(raw.endsWith("Z") ? raw : `${raw}Z`).getTime();
    return isFiniteNumber(parsed) ? parsed : null;
  }, [historyResp?.first_data_at]);

  const maxVisibleSpanMs = useMemo(
    () => computeMaxVisibleSpan(firstDataAt, nowMs),
    [firstDataAt, nowMs],
  );

  const chartGaps = useMemo(
    () =>
      (historyResp?.gaps ?? []).map((g) => ({
        fromMs: new Date(g.from_ts.endsWith("Z") ? g.from_ts : `${g.from_ts}Z`).getTime(),
        toMs: new Date(g.to_ts.endsWith("Z") ? g.to_ts : `${g.to_ts}Z`).getTime(),
      })).filter((g) => isFiniteNumber(g.fromMs) && isFiniteNumber(g.toMs) && g.toMs > g.fromMs),
    [historyResp?.gaps],
  );

  const historyPoints = useMemo<ChartPoint[]>(
    () =>
      (historyResp?.points ?? [])
        .filter((p) => p.ts != null && p.value != null)
        .map((p) => ({
          ts: new Date(p.ts!.endsWith("Z") ? p.ts! : `${p.ts!}Z`).getTime(),
          value: p.value as number,
          min_value: p.min_value ?? null,
          max_value: p.max_value ?? null,
        }))
        .filter((p) => isFiniteNumber(p.ts) && isFiniteNumber(p.value)),
    [historyResp],
  );

  const { interpolated: chartData, rawTimestamps } = useMemo(() => {
    if (historyPoints.length === 0) {
      return { interpolated: [] as ChartPoint[], rawTimestamps: new Set<number>() };
    }
    return interpolateToGrid(historyPoints, chartGaps);
  }, [chartGaps, historyPoints]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setFetchViewport(viewport);
    }, cameraMode === "live" ? 120 : 350);
    return () => window.clearTimeout(timeoutId);
  }, [cameraMode, viewport]);

  useEffect(() => {
    if (cameraMode !== "live") return;
    const syncLiveViewport = () => {
      const nextNowMs = livePoint ? Math.max(Date.now(), livePoint.ts) : Date.now();
      const nextViewport = alignViewportToLive(
        clampVisibleSpan(visibleSpanMs, maxVisibleSpanMs),
        nextNowMs,
        futureBufferMs,
      );
      const changed =
        Math.abs(nextViewport.from - viewport.from) > 250 ||
        Math.abs(nextViewport.to - viewport.to) > 250;
      if (!changed && nextNowMs === nowMs) return;
      setNowMs(nextNowMs);
      if (changed) {
        issueViewportCommand(nextViewport);
      }
    };

    const kickoffId = window.setTimeout(syncLiveViewport, 0);
    const intervalId = window.setInterval(syncLiveViewport, LIVE_TICK_MS);

    return () => {
      window.clearTimeout(kickoffId);
      window.clearInterval(intervalId);
    };
  }, [
    cameraMode,
    futureBufferMs,
    issueViewportCommand,
    livePoint,
    maxVisibleSpanMs,
    nowMs,
    visibleSpanMs,
    viewport.from,
    viewport.to,
  ]);

  useEffect(() => {
    if (maxVisibleSpanMs == null) return;
    if (visibleSpanMs <= maxVisibleSpanMs + 1) return;
    const timeoutId = window.setTimeout(() => {
      issueViewportCommand(
        alignViewportToLive(maxVisibleSpanMs, nowMs, getFutureBufferMs(maxVisibleSpanMs)),
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [issueViewportCommand, maxVisibleSpanMs, nowMs, visibleSpanMs]);

  const handlePresetClick = useCallback(
    (preset: HistoryRangeKey) => {
      const nextNowMs = Date.now();
      const targetSpan = clampVisibleSpan(RANGE_MS[preset], maxVisibleSpanMs);
      const nextViewport = alignViewportToLive(
        targetSpan,
        nextNowMs,
        getFutureBufferMs(RANGE_MS[preset]),
      );
      setNowMs(nextNowMs);
      setCameraMode("live");
      setFetchViewport(nextViewport);
      issueViewportCommand(nextViewport);
    },
    [issueViewportCommand, maxVisibleSpanMs],
  );

  const handleViewportChange = useCallback(
    (event: ViewportChangeEvent) => {
      if (
        !isFiniteNumber(event.from) ||
        !isFiniteNumber(event.to) ||
        !isFiniteNumber(event.spanMs) ||
        !isFiniteNumber(event.centerMs)
      ) {
        return;
      }
      const nextNowMs = Date.now();
      const clampedSpanMs = clampVisibleSpan(
        event.spanMs,
        computeMaxVisibleSpan(firstDataAt, nextNowMs),
      );

      setNowMs(nextNowMs);

      setCameraMode("manual");
      const nextViewport = sanitizeViewportRange(
        event.interaction === "zoom"
          ? Math.abs(clampedSpanMs - event.spanMs) > 1
            ? makeViewportFromCenter(event.centerMs, clampedSpanMs)
            : { from: event.from, to: event.to }
          : { from: event.from, to: event.to },
        viewport,
      );

      const wasClamped = Math.abs(clampedSpanMs - event.spanMs) > 1;
      setViewport(nextViewport);
      if (wasClamped) {
        setFetchViewport(nextViewport);
        issueViewportCommand(nextViewport);
      }
    },
    [firstDataAt, issueViewportCommand, viewport],
  );

  const selectedReg = REGISTER_OPTIONS.find((r) => r.addr === selectedAddr);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedAddr}
          onChange={(e) => setSelectedAddr(Number(e.target.value))}
          className="rounded-md border bg-card px-3 py-1.5 text-sm"
        >
          {REGISTER_OPTIONS.map((opt) => (
            <option key={opt.addr} value={opt.addr}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          {(Object.keys(RANGE_MS) as HistoryRangeKey[]).map((preset) => (
            <button
              key={preset}
              onClick={() => handlePresetClick(preset)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                activePreset === preset
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>

        <span className="flex items-center gap-1.5 text-xs text-emerald-500">
          <span
            className={`h-2 w-2 rounded-full ${
              cameraMode === "live"
                ? "bg-emerald-500 animate-pulse"
                : "bg-gray-400"
            }`}
          />
          {cameraMode === "live" ? "Live" : "History"}
        </span>
      </div>

      {isLoading && chartData.length === 0 ? (
        <Skeleton className="h-[380px] w-full rounded-xl" />
      ) : chartData.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Нет данных за выбранный период
          </CardContent>
        </Card>
      ) : (
        <HistoryChart
          data={chartData}
          label={selectedReg?.label}
          color={selectedReg?.color ?? "#22c55e"}
          isLoading={isLoading}
          onViewportChange={handleViewportChange}
          pendingRange={pendingRange}
          firstDataAt={firstDataAt}
          gaps={chartGaps}
          rawTimestamps={rawTimestamps}
          livePoint={livePoint}
        />
      )}
    </div>
  );
}
