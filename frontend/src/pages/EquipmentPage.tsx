import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Wifi, WifiOff } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import InlineEdit from "@/components/ui/inline-edit";
import { useIsAdmin } from "@/hooks/use-auth";
import { useRegisters } from "@/hooks/use-registers";
import { useHistory } from "@/hooks/use-history";
import { useEquipment } from "@/hooks/use-equipment";
import { useRenameEquipment } from "@/hooks/use-rename";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import { useSettingsStore } from "@/stores/settings-store";
import StatusBadge from "@/components/equipment/StatusBadge";
import MetricDisplay from "@/components/equipment/MetricDisplay";
import {
  fahrenheitToCelsius,
  secondsToMotohours,
} from "@/lib/conversions";
import { formatRelativeTime } from "@/lib/format";
import { HistoryChart, type ChartPoint, type HistoryChartHandle } from "@/components/equipment/HistoryChart";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function EquipmentPage() {
  const { routerSn, equipType, panelId } = useParams<{
    routerSn: string;
    equipType: string;
    panelId: string;
  }>();

  const isAdmin = useIsAdmin();
  const [activeTab, setActiveTab] = useState("history");

  const key = makeEquipKey(routerSn!, equipType!, panelId!);
  const liveRegs = useTelemetryStore((s) => s.registers.get(key));
  const liveStatus = useTelemetryStore((s) => s.statuses.get(key));
  const lastUpdate = useTelemetryStore((s) => s.lastUpdate.get(key));
  const wsConnected = useTelemetryStore((s) => s.connected);

  // Тик каждые 5 сек для обновления относительного времени
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  // Имя оборудования
  const { data: eqList } = useEquipment(routerSn!);
  const eqInfo = eqList?.find(
    (e) => e.equip_type === equipType && String(e.panel_id) === panelId,
  );
  const displayName = eqInfo?.name || `${equipType} #${panelId}`;

  const renameMutation = useRenameEquipment(routerSn!, equipType!, panelId!);
  const handleRename = useCallback(
    async (name: string) => {
      await renameMutation.mutateAsync(name);
    },
    [renameMutation],
  );

  const { data: registers, isLoading: regsLoading } = useRegisters(
    routerSn!,
    equipType!,
    panelId!,
  );

  // Merge REST registers with live data
  const mergedRegisters = useMemo(() => {
    if (!registers) return [];
    return registers.map((r) => {
      const live = liveRegs?.get(r.addr);
      if (live) {
        return { ...r, ...live };
      }
      return r;
    });
  }, [registers, liveRegs]);

  // Key metrics from live or REST
  function getMetricValue(addr: number): number | null {
    const live = liveRegs?.get(addr);
    if (live) {
      if (
        live.raw === 65535 ||
        live.raw === 32767 ||
        (live.reason && live.reason.toUpperCase().includes("NA"))
      )
        return null;
      return live.value;
    }
    const reg = registers?.find((r) => r.addr === addr);
    if (!reg || reg.value == null) return null;
    return reg.value;
  }

  const installedPower = getMetricValue(43019);
  const currentLoad = getMetricValue(40034);
  const rawHours = getMetricValue(40070);
  const engineHours = rawHours != null ? secondsToMotohours(rawHours) : null;

  const rawTemp = getMetricValue(40063);
  const tempReg = liveRegs?.get(40063) || registers?.find((r) => r.addr === 40063);
  const tempUnit = tempReg?.unit || "";
  const oilTempC =
    rawTemp != null
      ? tempUnit.toLowerCase().includes("f")
        ? fahrenheitToCelsius(rawTemp)
        : Math.round(rawTemp * 10) / 10
      : null;

  const oilPressure = getMetricValue(40062);

  // liveStatus = ONLINE/OFFLINE (статус связи из telemetry-store)
  const connectionStatus = liveStatus ?? "OFFLINE";

  // Состояние двигателя из регистра 46109
  const stateReg = liveRegs?.get(46109) || registers?.find((r) => r.addr === 46109);
  let engineState: string | null = null;
  if (stateReg?.text) {
    const t = stateReg.text.toLowerCase();
    if (t.includes("stopped") || t.includes("stop")) engineState = "STOP";
    else if (t.includes("shutdown") || t.includes("alarm") || t.includes("fault")) engineState = "ALARM";
    else engineState = "RUN";
  }

  // Если есть связь и известно состояние двигателя — показываем его, иначе статус связи
  const status = connectionStatus === "ONLINE" && engineState ? engineState : connectionStatus;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to={`/objects/${routerSn}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад к объекту
      </Link>

      {/* Hero block */}
      <Card className="border">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl">
              {isAdmin ? (
                <InlineEdit
                  value={displayName}
                  placeholder={`${equipType} #${panelId}`}
                  onSave={handleRename}
                  inputClassName="text-xl font-semibold w-56"
                />
              ) : (
                displayName
              )}
            </CardTitle>
            <p className="text-sm text-muted-foreground font-mono">
              {routerSn}
            </p>
            <div className="flex items-center gap-3 mt-1">
              {lastUpdate && now - lastUpdate < 30_000 ? (
                <span className="flex items-center gap-1 text-xs text-green-500">
                  <Wifi className="h-3 w-3" />
                  на связи
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <WifiOff className="h-3 w-3" />
                  нет данных
                </span>
              )}
              {lastUpdate && (
                <span className="text-xs text-muted-foreground">
                  · {formatRelativeTime(new Date(lastUpdate))}
                </span>
              )}
            </div>
          </div>
          <StatusBadge status={status} />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
            <MetricDisplay label="Мощность уст." value={installedPower} unit="кВт" decimals={0} />
            <MetricDisplay label="Нагрузка" value={currentLoad} unit="кВт" decimals={1} />
            <MetricDisplay label="Моточасы" value={engineHours} unit="ч" decimals={0} />
            <MetricDisplay label="t масла" value={oilTempC} unit="°C" />
            <MetricDisplay label="P масла" value={oilPressure} unit="кПа" decimals={0} />
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="history" className="w-full" onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="registers">Регистры</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab status={status} installedPower={installedPower} currentLoad={currentLoad} />
        </TabsContent>

        <TabsContent value="registers" className="mt-4">
          <RegistersTab
            registers={mergedRegisters}
            isLoading={regsLoading}
            liveCount={liveRegs?.size ?? 0}
            wsConnected={wsConnected}
            lastWsUpdate={lastUpdate}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {activeTab === "history" && (
            <ErrorBoundary>
              <HistoryTab
                routerSn={routerSn!}
                equipType={equipType!}
                panelId={panelId!}
              />
            </ErrorBoundary>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Overview Tab ---
function OverviewTab({
  status,
  installedPower,
  currentLoad,
}: {
  status: string;
  installedPower: number | null;
  currentLoad: number | null;
}) {
  const loadPercent =
    installedPower && currentLoad
      ? Math.round((currentLoad / installedPower) * 100)
      : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Состояние</p>
          <div className="mt-2">
            <StatusBadge status={status} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Загрузка</p>
          <p className="text-3xl font-bold tabular-nums mt-1">
            {loadPercent != null ? `${loadPercent}%` : "\u2014"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Мощность</p>
          <p className="text-3xl font-bold tabular-nums mt-1">
            {currentLoad != null
              ? `${currentLoad.toFixed(1)} кВт`
              : "\u2014"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Flash Cell: подсветка при изменении значения ---
function FlashCell({
  value,
  className = "",
  children,
}: {
  value: unknown;
  className?: string;
  children: React.ReactNode;
}) {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [value]);

  return (
    <TableCell
      className={`${className} transition-colors duration-1000 ${
        flash ? "bg-primary/15" : ""
      }`}
    >
      {children}
    </TableCell>
  );
}

// --- Registers Tab ---
function RegistersTab({
  registers,
  isLoading,
  liveCount,
  wsConnected,
  lastWsUpdate,
}: {
  registers: Array<{
    addr: number;
    name: string | null;
    value: number | null;
    raw: number | null;
    text: string | null;
    unit: string | null;
    reason: string | null;
    ts: string | null;
    receivedAt?: string;
    updated_at: string | null;
  }>;
  isLoading: boolean;
  liveCount: number;
  wsConnected: boolean;
  lastWsUpdate: number | undefined;
}) {
  const [search, setSearch] = useState("");
  const [showNA, setShowNA] = useState(true);

  const filtered = useMemo(() => {
    let result = registers;
    if (!showNA) {
      result = result.filter(
        (r) =>
          !(
            r.raw === 65535 ||
            r.raw === 32767 ||
            (r.reason && r.reason.toUpperCase().includes("NA"))
          ),
      );
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          String(r.addr).includes(q) ||
          (r.name && r.name.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [registers, search, showNA]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Поиск по адресу или имени..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showNA}
              onChange={(e) => setShowNA(e.target.checked)}
              className="rounded"
            />
            Показывать NA
          </label>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {wsConnected ? (
            <Wifi className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-red-500" />
          )}
          <span>
            {wsConnected ? "WS подключён" : "WS отключён"}
            {liveCount > 0 && ` · ${liveCount} live`}
          </span>
          {lastWsUpdate && (
            <span>· {formatRelativeTime(new Date(lastWsUpdate))}</span>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-auto max-h-[600px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Адрес</TableHead>
              <TableHead>Имя</TableHead>
              <TableHead>Значение</TableHead>
              <TableHead>Текст</TableHead>
              <TableHead className="w-16">Ед.</TableHead>
              <TableHead className="hidden lg:table-cell">Обновлено</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.addr}>
                <TableCell className="font-mono text-xs">{r.addr}</TableCell>
                <TableCell className="text-sm">{r.name || "\u2014"}</TableCell>
                <FlashCell value={r.value} className="font-semibold tabular-nums">
                  {r.value != null
                    ? Number.isInteger(r.value)
                      ? r.value
                      : parseFloat(r.value.toFixed(4))
                    : "\u2014"}
                </FlashCell>
                <FlashCell value={r.text} className="text-xs text-muted-foreground">
                  {r.text || ""}
                </FlashCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.unit || ""}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {r.receivedAt
                    ? formatRelativeTime(r.receivedAt)
                    : r.ts
                      ? formatRelativeTime(r.ts)
                      : "\u2014"}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Регистры не найдены
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// --- History Tab ---
// Биржевой паттерн:
//  • Кнопки диапазона загружают данные целиком (≤2000 точек)
//  • Pan — свободный, без API-запросов
//  • Zoom — при значительном изменении масштаба → fetch с другой детализацией
//  • Live — дописываем точки, авто-скролл если пользователь не двигал

const REGISTER_OPTIONS = [
  { addr: 40034, label: "Нагрузка (кВт)",      color: "#22c55e" },
  { addr: 40070, label: "Наработка (сек)",      color: "#3b82f6" },
  { addr: 40063, label: "Температура масла",    color: "#f97316" },
  { addr: 40062, label: "Давление масла",       color: "#a855f7" },
  { addr: 40290, label: "ControllerOn Time",    color: "#06b6d4" },
];

// Видимый диапазон на экране при нажатии кнопки
const RANGE_MS: Record<string, number> = {
  "1h":  4 * 3_600_000,       // кнопка «1ч»  → видно 4ч
  "24h": 86_400_000,           // кнопка «24ч» → видно 24ч
  "7d":  7  * 86_400_000,      // 7д
  "30d": 30 * 86_400_000,      // 30д
};

// Буфер «будущего» справа — синяя зона всегда видна
const FUTURE_BUFFER_MS: Record<string, number> = {
  "1h":  15 * 60_000,          // 15 мин → итого ~4ч15мин
  "24h": 2  * 3_600_000,       // 2ч    → итого 26ч
  "7d":  86_400_000,           // 1д    → итого 8д
  "30d": 86_400_000,           // 1д    → итого 31д
};

const GRID_MS = 2_000;          // шаг интерполяции: 2 сек
const RAW_THRESHOLD_MS = 60_000; // медиана ≤ 60с → raw-данные → интерполируем

/**
 * Заполняет пробелы между RAW-точками линейной интерполяцией с шагом GRID_MS.
 * Через gap-зоны (красные) не заполняем.
 * Для агрегированных данных (медиана > 60с) — возвращает как есть.
 */
function interpolateToGrid(
  rawPoints: ChartPoint[],
  gapZones: Array<{ fromMs: number; toMs: number }>,
): { interpolated: ChartPoint[]; rawTimestamps: Set<number> } {
  const rawTimestamps = new Set<number>(rawPoints.map((p) => p.ts));
  if (rawPoints.length < 2) return { interpolated: rawPoints, rawTimestamps };

  // Медианный интервал
  const intervals: number[] = [];
  for (let i = 1; i < rawPoints.length; i++)
    intervals.push(rawPoints[i].ts - rawPoints[i - 1].ts);
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];

  // Агрегированные данные — не трогаем
  if (median > RAW_THRESHOLD_MS) return { interpolated: rawPoints, rawTimestamps };

  const result: ChartPoint[] = [];
  for (let i = 0; i < rawPoints.length; i++) {
    result.push(rawPoints[i]);
    if (i < rawPoints.length - 1) {
      const p0 = rawPoints[i];
      const p1 = rawPoints[i + 1];
      const gapMs = p1.ts - p0.ts;
      // Не заполняем через gap-зоны (красные зоны от backend)
      const isGap = gapZones.some((g) => g.fromMs < p1.ts && g.toMs > p0.ts);
      if (!isGap && gapMs > GRID_MS) {
        const steps = Math.floor(gapMs / GRID_MS);
        for (let j = 1; j < steps; j++) {
          const t = p0.ts + j * GRID_MS;
          const ratio = (t - p0.ts) / gapMs;
          result.push({ ts: t, value: p0.value + ratio * (p1.value - p0.value) });
        }
      }
    }
  }
  return { interpolated: result, rawTimestamps };
}

/** Интервалы live-обновлений (подгрузка новых точек справа) */
const LIVE_INTERVAL_MS: Record<string, number> = {
  "1h":  15_000,
  "24h": 2 * 60_000,
  "7d":  2 * 60_000,
  "30d": 2 * 60_000,
};

/**
 * Пороги для определения уровня детализации по видимому span.
 * Гистерезис (×1.3) при zoom-out предотвращает «прыжки» между уровнями:
 *  — zoom-in: переход в более детальный уровень при уменьшении span
 *  — zoom-out: переход в более грубый уровень только при span × 1.3 от границы
 */
const HYSTERESIS = 1.3;
function spanToRange(spanMs: number, currentRange: string): string {
  if (currentRange === "1h") {
    return spanMs > RANGE_MS["1h"] * HYSTERESIS ? "24h" : "1h";  // > 5.2h → 24h
  }
  if (currentRange === "24h") {
    if (spanMs <= RANGE_MS["1h"])               return "1h";      // ≤ 4h
    if (spanMs > RANGE_MS["24h"] * HYSTERESIS)  return "7d";      // > 31.2h
    return "24h";
  }
  if (currentRange === "7d") {
    if (spanMs <= RANGE_MS["24h"])              return "24h";     // ≤ 24h
    if (spanMs > RANGE_MS["7d"] * HYSTERESIS)   return "30d";     // > 9.1д
    return "7d";
  }
  // "30d"
  if (spanMs <= RANGE_MS["7d"]) return "7d";                      // ≤ 7д
  return "30d";
}

/** Слияние двух массивов ChartPoint с дедупликацией по ts */
function mergeChartData(a: ChartPoint[], b: ChartPoint[]): ChartPoint[] {
  const map = new Map<number, ChartPoint>();
  for (const p of a) map.set(p.ts, p);
  for (const p of b) map.set(p.ts, p); // новые данные перезаписывают старые
  return [...map.values()].sort((x, y) => x.ts - y.ts);
}

function HistoryTab({
  routerSn,
  equipType,
  panelId,
}: {
  routerSn: string;
  equipType: string;
  panelId: string;
}) {
  const chartRef = useRef<HistoryChartHandle>(null);
  const minGapPoints = useSettingsStore((s) => s.minGapPoints);

  const [selectedAddr, setSelectedAddr] = useState(40034);
  const [range, setRange]               = useState("24h");

  // Накопленные данные при zoom/pan — не теряем уже загруженное
  const [accumulatedData, setAccumulatedData] = useState<ChartPoint[]>([]);
  const [rawTimestamps, setRawTimestamps]      = useState<Set<number>>(new Set());
  const zoomOverrideRef    = useRef<{ spanMs: number; centerMs: number } | null>(null);
  const rangeRef           = useRef(range);
  rangeRef.current         = range;
  /** true = уровень детализации сменился → следующий fetch заменяет, не мёржит */
  const levelChangedRef    = useRef(false);
  // Счётчик нажатий кнопки — гарантирует вызов setVisibleRange при повторном клике
  const [rangeKey, setRangeKey] = useState(0);

  // zoomOverride: при зуме пользователем — запрашиваем другой диапазон с центром
  // null = используем стандартный range (кнопка)
  const [zoomOverride, setZoomOverride] = useState<{
    spanMs: number;
    centerMs: number;
  } | null>(null);

  zoomOverrideRef.current = zoomOverride;

  // Live-тик: обновляет данные, только если нет zoom-override
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (zoomOverride) return;  // при ручном зуме — пауза live
    const id = setInterval(
      () => setNowTick(Date.now()),
      LIVE_INTERVAL_MS[range] ?? LIVE_INTERVAL_MS["24h"],
    );
    return () => clearInterval(id);
  }, [range, zoomOverride]);

  // Смена диапазона кнопкой: показать только выбранный range, буфер — за кадром
  const handleRangeChange = useCallback((r: string) => {
    setRange(r);
    setZoomOverride(null);
    setAccumulatedData([]);
    setNowTick(Date.now());
    setRangeKey((k) => k + 1);
  }, []);

  // Callback из графика: zoom изменил масштаб, или pan достиг края данных
  const handleNeedData = useCallback((visibleSpanMs: number, centerMs: number) => {
    const now = Date.now();
    const currentRange = rangeRef.current;
    const newRange = spanToRange(visibleSpanMs, currentRange);
    const halfRange = RANGE_MS[newRange] / 2;
    // Ограничиваем center: не дальше now - halfRange (чтобы не запрашивать будущее)
    const clampedCenter = Math.min(centerMs, now - halfRange);
    // При смене уровня (raw↔min↔hour) следующий fetch заменяет данные, не мёржит
    if (newRange !== currentRange) {
      levelChangedRef.current = true;
    }
    setZoomOverride({ spanMs: RANGE_MS[newRange], centerMs: clampedCenter });
    setRange(newRange);
  }, []);

  // Запрашиваемый диапазон.
  // На широком экране видимая область может вмещать больше номинала
  // (напр. 4ч при «1ч»). Множитель адаптивный:
  //   1ч  → ×12 = 12ч (3 экрана буфера при 4ч видимых)
  //   24ч → ×4  = 96ч (3 экрана буфера при 24ч видимых)
  //   7d  → ×3  = 21д
  //   30d → ×2  = 60д
  // RANGE_MS["1h"]=4ч → ×3 = 12ч загрузки (8ч буфер слева)
  // RANGE_MS["24h"]=24ч → ×4 = 96ч (72ч буфер)
  const FETCH_MULTIPLIER_MAP: Record<string, number> = {
    "1h": 3, "24h": 4, "7d": 3, "30d": 2,
  };
  const fetchMultiplier = FETCH_MULTIPLIER_MAP[range] ?? 4;

  const { queryStart, queryEnd } = useMemo(() => {
    if (zoomOverride) {
      // Zoom/pan-edge: грузим fetchMultiplier × span со смещением влево
      const fetchSpan = zoomOverride.spanMs * fetchMultiplier;
      const now = Date.now();
      // centerMs — центр видимой области. Правый край = center + span/2
      const rightEdge = Math.min(zoomOverride.centerMs + zoomOverride.spanMs / 2, now);
      const start = rightEdge - fetchSpan;
      return {
        queryStart: new Date(start).toISOString(),
        queryEnd:   new Date(rightEdge).toISOString(),
      };
    }
    // Стандартный range: загружаем fetchMultiplier × rangeMs влево
    const nowMs = nowTick;
    const rangeMs = RANGE_MS[range] ?? RANGE_MS["24h"];
    return {
      queryStart: new Date(nowMs - rangeMs * fetchMultiplier).toISOString(),
      queryEnd:   new Date(nowMs).toISOString(),
    };
  }, [range, nowTick, zoomOverride, fetchMultiplier]);

  // Запрашиваем столько точек, чтобы покрыть 4 экрана по ширине.
  // Минимум 2000 (по умолчанию backend), максимум 20000 (ограничение API).
  const targetPoints = useMemo(
    () => Math.min(20000, Math.max(2000, window.innerWidth * 4)),
    [],
  );

  const { data: historyResp, isLoading, isFetching } = useHistory(
    routerSn, equipType, panelId, selectedAddr, queryStart, queryEnd, targetPoints, true, minGapPoints,
  );

  const rawChartData = useMemo<ChartPoint[]>(
    () =>
      (historyResp?.points ?? [])
        .filter((p) => p.ts != null && p.value != null)
        .map((p) => ({
          // Бэкенд отдаёт UTC без суффикса ('2026-03-15T04:17:24'),
          // JS без 'Z' трактует как локальное время → добавляем 'Z'.
          ts:        new Date(p.ts!.endsWith("Z") ? p.ts! : p.ts! + "Z").getTime(),
          value:     p.value as number,
          min_value: p.min_value ?? null,
          max_value: p.max_value ?? null,
        })),
    [historyResp],
  );

  // Граница серой зоны — первая запись в БД
  const firstDataAt = useMemo(() => {
    const raw = historyResp?.first_data_at;
    if (!raw) return null;
    const s = raw.endsWith("Z") ? raw : raw + "Z";
    return new Date(s).getTime();
  }, [historyResp?.first_data_at]);

  // Красные зоны — разрывы данных
  const chartGaps = useMemo(
    () =>
      (historyResp?.gaps ?? []).map((g) => ({
        fromMs: new Date(g.from_ts.endsWith("Z") ? g.from_ts : g.from_ts + "Z").getTime(),
        toMs:   new Date(g.to_ts.endsWith("Z")   ? g.to_ts   : g.to_ts   + "Z").getTime(),
      })),
    [historyResp?.gaps],
  );

  // Накапливаем данные при zoom/pan, сбрасываем при live-обновлениях.
  // Применяем интерполяцию 2с-сетки для raw-данных.
  // При смене уровня детализации (raw↔1min↔1hour) — заменяем, не мёржим.
  useEffect(() => {
    if (rawChartData.length === 0) return;
    const { interpolated, rawTimestamps: newRawTs } = interpolateToGrid(rawChartData, chartGaps);
    const shouldMerge = zoomOverrideRef.current && !levelChangedRef.current;
    if (shouldMerge) {
      setRawTimestamps((prev) => {
        const merged = new Set(prev);
        for (const ts of newRawTs) merged.add(ts);
        return merged;
      });
      setAccumulatedData((prev) => mergeChartData(prev, interpolated));
    } else {
      levelChangedRef.current = false;
      setRawTimestamps(newRawTs);
      setAccumulatedData(interpolated);
    }
  }, [rawChartData, chartGaps]);

  // Желаемый видимый диапазон — пересчитывается при каждом клике кнопки.
  // Правый край сдвигаем в будущее (FUTURE_BUFFER_MS) — синяя зона всегда видна.
  const pendingRange = useMemo(() => {
    const rangeMs      = RANGE_MS[range]         ?? RANGE_MS["24h"];
    const futureBuffer = FUTURE_BUFFER_MS[range] ?? 2 * 3_600_000;
    const now = Date.now();
    return { from: now - rangeMs, to: now + futureBuffer, key: rangeKey };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const chartData = accumulatedData;

  const selectedReg = REGISTER_OPTIONS.find((r) => r.addr === selectedAddr);

  return (
    <div className="space-y-4">
      {/* Панель управления */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Выбор регистра */}
        <select
          value={selectedAddr}
          onChange={(e) => setSelectedAddr(Number(e.target.value))}
          className="rounded-md border bg-card px-3 py-1.5 text-sm"
        >
          {REGISTER_OPTIONS.map((opt) => (
            <option key={opt.addr} value={opt.addr}>{opt.label}</option>
          ))}
        </select>

        {/* Кнопки диапазона */}
        <div className="flex gap-1">
          {Object.keys(RANGE_MS).map((r) => (
            <button
              key={r}
              onClick={() => handleRangeChange(r)}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${
                range === r && !zoomOverride
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Live-индикатор */}
        <span className="flex items-center gap-1.5 text-xs text-emerald-500">
          <span className={`h-2 w-2 rounded-full ${
            zoomOverride
              ? "bg-gray-400"                              // пауза live
              : isFetching
                ? "bg-amber-400"                           // загрузка
                : "bg-emerald-500 animate-pulse"           // live
          }`} />
          {zoomOverride ? "Zoom" : "Live"}
        </span>
      </div>

      {/* График */}
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
          ref={chartRef}
          data={chartData}
          label={selectedReg?.label}
          color={selectedReg?.color ?? "#22c55e"}
          isLoading={isFetching}
          onNeedData={handleNeedData}
          pendingRange={zoomOverride ? null : pendingRange}
          firstDataAt={firstDataAt}
          gaps={chartGaps}
          rawTimestamps={rawTimestamps}
        />
      )}
    </div>
  );
}
