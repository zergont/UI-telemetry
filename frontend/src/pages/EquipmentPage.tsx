import { useState, useMemo, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Wifi, WifiOff } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import InlineEdit from "@/components/ui/inline-edit";
import { useIsAdmin } from "@/hooks/use-auth";
import { useRegisters } from "@/hooks/use-registers";
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
import RegistersTab from "@/components/equipment/registers/RegistersTab";
import HistoryTab from "@/components/equipment/history/HistoryTab";
import JournalTab from "@/components/equipment/journal/JournalTab";
import NotificationsTab from "@/components/equipment/notifications/NotificationsTab";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function EquipmentPage() {
  const { routerSn, equipType, panelId } = useParams<{
    routerSn: string;
    equipType: string;
    panelId: string;
  }>();

  const isAdmin = useIsAdmin();
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
                <span className="flex items-center gap-1 text-xs text-blue-500">
                  <Wifi className="h-3 w-3" />
                  на связи
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-slate-400">
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
      <Tabs defaultValue="history" className="w-full">
        <TabsList>
          <TabsTrigger value="history">График</TabsTrigger>
          <TabsTrigger value="registers">Регистры</TabsTrigger>
          <TabsTrigger value="journal">Журнал</TabsTrigger>
          <TabsTrigger value="notifications">Уведомления</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-4">
          <ErrorBoundary>
            <HistoryTab
              routerSn={routerSn!}
              equipType={equipType!}
              panelId={panelId!}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="registers" className="mt-4">
          <ErrorBoundary>
            <RegistersTab
              registers={mergedRegisters}
              isLoading={regsLoading}
              liveCount={liveRegs?.size ?? 0}
              wsConnected={wsConnected}
              lastWsUpdate={lastUpdate}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="journal" className="mt-4">
          <ErrorBoundary>
            <JournalTab
              routerSn={routerSn!}
              equipType={equipType!}
              panelId={panelId!}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <ErrorBoundary>
            <NotificationsTab
              routerSn={routerSn!}
              equipType={equipType!}
              panelId={panelId!}
            />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}
