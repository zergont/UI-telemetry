import { useMemo } from "react";
import { AlertTriangle, ShieldAlert, Info, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNotifications, type NotificationOut } from "@/hooks/use-notifications";

interface NotificationsTabProps {
  routerSn: string;
  equipType: string;
  panelId: string;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds} с`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин`;
  return `${Math.floor(seconds / 86400)} д ${Math.floor((seconds % 86400) / 3600)} ч`;
}

function SeverityBadge({ severity }: { severity: string | null }) {
  if (severity === "shutdown") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-red-500/15 text-red-600 dark:text-red-400">
        <ShieldAlert className="h-3 w-3" />
        shutdown
      </span>
    );
  }
  if (severity === "warning") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">
        <AlertTriangle className="h-3 w-3" />
        warning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
      <Info className="h-3 w-3" />
      {severity ?? "info"}
    </span>
  );
}

function rowClass(n: NotificationOut): string {
  const active = n.fault_end === null;
  if (n.severity === "shutdown") return active ? "bg-red-500/10" : "bg-red-500/5";
  if (n.severity === "warning") return active ? "bg-yellow-500/10" : "bg-yellow-500/5";
  return "";
}

export default function NotificationsTab({ routerSn, equipType, panelId }: NotificationsTabProps) {
  const { data, isLoading, refetch, isFetching } = useNotifications(routerSn, equipType, panelId);

  const { active, historical } = useMemo(() => {
    const all = data ?? [];
    return {
      active:     all.filter((n) => n.fault_end === null),
      historical: all.filter((n) => n.fault_end !== null),
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const columns = (
    <TableHeader>
      <TableRow>
        <TableHead>Название</TableHead>
        <TableHead className="w-28">Серьёзность</TableHead>
        <TableHead className="w-20 hidden sm:table-cell">Адрес/Бит</TableHead>
        <TableHead className="hidden md:table-cell">Начало</TableHead>
        <TableHead className="hidden md:table-cell">Конец</TableHead>
        <TableHead className="w-28">Длительность</TableHead>
      </TableRow>
    </TableHeader>
  );

  const renderRow = (n: NotificationOut, idx: number) => (
    <TableRow key={idx} className={rowClass(n)}>
      <TableCell className="font-medium text-sm" title={n.fault_name ?? undefined}>
        {n.fault_description || n.fault_name || "—"}
      </TableCell>
      <TableCell><SeverityBadge severity={n.severity} /></TableCell>
      <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">
        {n.addr}/{n.bit}
      </TableCell>
      <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
        {new Date(n.fault_start).toLocaleString("ru-RU")}
      </TableCell>
      <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
        {n.fault_end
          ? new Date(n.fault_end).toLocaleString("ru-RU")
          : <span className="text-red-500 font-medium">активна</span>}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {n.fault_end ? formatDuration(n.duration_seconds) : "—"}
      </TableCell>
    </TableRow>
  );

  const isEmpty = active.length === 0 && historical.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {active.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              {active.length} активных
            </span>
          )}
          {active.length === 0 && (
            <span className="text-sm text-muted-foreground">Активных уведомлений нет</span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      {isEmpty ? (
        <div className="rounded-xl border bg-card py-16 text-center text-muted-foreground">
          Уведомлений не найдено
        </div>
      ) : (
        <div className="space-y-4">
          {/* Активные */}
          {active.length > 0 && (
            <div className="overflow-auto rounded-xl border bg-card">
              <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Активные
              </div>
              <Table>
                {columns}
                <TableBody>{active.map(renderRow)}</TableBody>
              </Table>
            </div>
          )}

          {/* История */}
          {historical.length > 0 && (
            <div className="overflow-auto rounded-xl border bg-card">
              <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                История
              </div>
              <Table>
                {columns}
                <TableBody>{historical.map(renderRow)}</TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
