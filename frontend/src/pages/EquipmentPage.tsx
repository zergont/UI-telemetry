import { useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
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
import { useRegisters } from "@/hooks/use-registers";
import { useHistory } from "@/hooks/use-history";
import { useTelemetryStore, makeEquipKey } from "@/stores/telemetry-store";
import StatusBadge from "@/components/equipment/StatusBadge";
import MetricDisplay from "@/components/equipment/MetricDisplay";
import {
  fahrenheitToCelsius,
  secondsToMotohours,
} from "@/lib/conversions";
import { formatRelativeTime } from "@/lib/format";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

export default function EquipmentPage() {
  const { routerSn, equipType, panelId } = useParams<{
    routerSn: string;
    equipType: string;
    panelId: string;
  }>();

  const key = makeEquipKey(routerSn!, equipType!, panelId!);
  const liveRegs = useTelemetryStore((s) => s.registers.get(key));
  const liveStatus = useTelemetryStore((s) => s.statuses.get(key));
  const lastUpdate = useTelemetryStore((s) => s.lastUpdate.get(key));

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

  const stateReg = liveRegs?.get(46109) || registers?.find((r) => r.addr === 46109);
  const status = liveStatus ?? (stateReg?.text?.includes("Stopped") ? "STOP" : "RUN");

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
              {equipType} #{panelId}
            </CardTitle>
            <p className="text-sm text-muted-foreground font-mono">
              {routerSn}
            </p>
            {lastUpdate && (
              <p className="text-xs text-muted-foreground mt-1">
                Обновлено: {formatRelativeTime(new Date(lastUpdate))}
              </p>
            )}
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
      <Tabs defaultValue="registers" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="registers">Регистры</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab status={status} installedPower={installedPower} currentLoad={currentLoad} />
        </TabsContent>

        <TabsContent value="registers" className="mt-4">
          <RegistersTab registers={mergedRegisters} isLoading={regsLoading} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryTab
            routerSn={routerSn!}
            equipType={equipType!}
            panelId={panelId!}
          />
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

// --- Registers Tab ---
function RegistersTab({
  registers,
  isLoading,
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
    updated_at: string | null;
  }>;
  isLoading: boolean;
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
                <TableCell className="font-semibold tabular-nums">
                  {r.value != null ? r.value : "\u2014"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.text || ""}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.unit || ""}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {r.ts ? formatRelativeTime(r.ts) : "\u2014"}
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
function HistoryTab({
  routerSn,
  equipType,
  panelId,
}: {
  routerSn: string;
  equipType: string;
  panelId: string;
}) {
  const [selectedAddr, setSelectedAddr] = useState(40034); // default: load kW
  const [range, setRange] = useState("24h");

  const rangeMs: Record<string, number> = {
    "1h": 3600_000,
    "24h": 86400_000,
    "7d": 7 * 86400_000,
    "30d": 30 * 86400_000,
  };

  // Стабилизируем start/end — пересчитываются только при смене range
  const { start, end } = useMemo(() => {
    const now = new Date();
    // Округляем до минуты чтобы query key не менялся каждый ререндер
    now.setSeconds(0, 0);
    return {
      start: new Date(now.getTime() - (rangeMs[range] || rangeMs["24h"])).toISOString(),
      end: now.toISOString(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const { data: history, isLoading } = useHistory(
    routerSn,
    equipType,
    panelId,
    selectedAddr,
    start,
    end,
  );

  const chartData = useMemo(
    () =>
      (history ?? []).map((p) => ({
        ts: p.ts ? new Date(p.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "",
        value: p.value,
      })),
    [history],
  );

  const REGISTER_OPTIONS = [
    { addr: 40034, label: "Нагрузка (кВт)" },
    { addr: 40070, label: "Наработка (сек)" },
    { addr: 40063, label: "Температура масла" },
    { addr: 40062, label: "Давление масла" },
  ];

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
          {Object.keys(rangeMs).map((r) => (
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
      </div>

      {isLoading ? (
        <Skeleton className="h-[400px] w-full rounded-xl" />
      ) : chartData.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Нет данных за выбранный период
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border bg-card p-4">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-muted"
              />
              <XAxis
                dataKey="ts"
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
