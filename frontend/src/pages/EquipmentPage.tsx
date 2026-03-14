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
import StatusBadge from "@/components/equipment/StatusBadge";
import MetricDisplay from "@/components/equipment/MetricDisplay";
import {
  fahrenheitToCelsius,
  secondsToMotohours,
} from "@/lib/conversions";
import { formatRelativeTime } from "@/lib/format";
import { HistoryChart, type ChartPoint } from "@/components/equipment/HistoryChart";

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
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 5_000);
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
              {lastUpdate && Date.now() - lastUpdate < 30_000 ? (
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
            <HistoryTab
              routerSn={routerSn!}
              equipType={equipType!}
              panelId={panelId!}
            />
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

const REGISTER_OPTIONS = [
  { addr: 40034, label: "Нагрузка (кВт)",      color: "#22c55e" },
  { addr: 40070, label: "Наработка (сек)",      color: "#3b82f6" },
  { addr: 40063, label: "Температура масла",    color: "#f97316" },
  { addr: 40062, label: "Давление масла",       color: "#a855f7" },
  { addr: 40290, label: "ControllerOn Time",    color: "#06b6d4" },
];

const RANGE_MS: Record<string, number> = {
  "1h":  3_600_000,
  "24h": 86_400_000,
  "7d":  7  * 86_400_000,
  "30d": 30 * 86_400_000,
};

// Для коротких диапазонов скользящее окно обновляется автоматически
const LIVE_INTERVAL_MS: Record<string, number> = {
  "1h":  60_000,        // каждую минуту
  "24h": 5 * 60_000,    // каждые 5 мин
};

function HistoryTab({
  routerSn,
  equipType,
  panelId,
}: {
  routerSn: string;
  equipType: string;
  panelId: string;
}) {
  const [selectedAddr, setSelectedAddr] = useState(40034);
  const [range, setRange]               = useState("24h");

  const isLive = range in LIVE_INTERVAL_MS;

  // Live-тик: сдвигает скользящее окно для коротких диапазонов
  const [nowTick, setNowTick] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(
      () => setNowTick(Math.floor(Date.now() / 60_000) * 60_000),
      LIVE_INTERVAL_MS[range],
    );
    return () => clearInterval(id);
  }, [range, isLive]);

  // Запрашиваемый диапазон
  const { queryStart, queryEnd } = useMemo(() => {
    const now = new Date(isLive ? nowTick : Date.now());
    now.setSeconds(0, 0);
    const start = new Date(now.getTime() - (RANGE_MS[range] ?? RANGE_MS["24h"]));
    return { queryStart: start.toISOString(), queryEnd: now.toISOString() };
  }, [range, nowTick, isLive]);

  const { data: history, isLoading, isFetching } = useHistory(
    routerSn, equipType, panelId, selectedAddr, queryStart, queryEnd,
  );

  const chartData = useMemo<ChartPoint[]>(
    () =>
      (history ?? [])
        .filter((p) => p.ts != null && p.value != null)
        .map((p) => ({
          ts:        new Date(p.ts!).getTime(),
          value:     p.value as number,
          min_value: p.min_value ?? null,
          max_value: p.max_value ?? null,
        })),
    [history],
  );

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
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${
                range === r
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Live-индикатор */}
        {isLive && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-500">
            <span className={`h-2 w-2 rounded-full ${
              isFetching ? "bg-amber-400" : "bg-emerald-500 animate-pulse"
            }`} />
            Live
          </span>
        )}
      </div>

      {/* График */}
      {isLoading ? (
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
          isFetching={isFetching}
        />
      )}
    </div>
  );
}
