import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useJournal } from "@/hooks/use-journal";

interface JournalTabProps {
  routerSn: string;
  equipType: string;
  panelId: string;
}

const LIMIT_STEP = 500;
const LIMIT_MAX = 2000;

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU");
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds} с`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин`;
  return `${Math.floor(seconds / 86400)} д ${Math.floor((seconds % 86400) / 3600)} ч`;
}

export default function JournalTab({ routerSn, equipType, panelId }: JournalTabProps) {
  const [limit, setLimit] = useState(LIMIT_STEP);
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch, isFetching } = useJournal(routerSn, equipType, panelId, limit);

  const filtered = useMemo(() => {
    const events = data?.events ?? [];
    if (!search) return events;
    const q = search.toLowerCase();
    return events.filter(
      (e) =>
        String(e.addr).includes(q) ||
        (e.name && e.name.toLowerCase().includes(q)) ||
        (e.text && e.text.toLowerCase().includes(q)),
    );
  }, [data, search]);

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
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Поиск по адресу, имени или состоянию..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} записей
        </span>
        <button
          onClick={() => refetch()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      <div className="max-h-[600px] overflow-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden lg:table-cell w-44">Начало</TableHead>
              <TableHead className="hidden lg:table-cell w-44">Конец</TableHead>
              <TableHead className="hidden md:table-cell w-28">Длительность</TableHead>
              <TableHead className="w-20">Адрес</TableHead>
              <TableHead>Имя</TableHead>
              <TableHead>Состояние</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e, idx) => {
              const isActive = e.state_end === null;
              return (
                <TableRow key={idx} className={isActive ? "bg-blue-500/5" : ""}>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell whitespace-nowrap">
                    {formatTs(e.ts)}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell whitespace-nowrap">
                    {e.state_end
                      ? formatTs(e.state_end)
                      : <span className="text-blue-500 font-medium">активно</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                    {formatDuration(e.duration_seconds)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.addr}</TableCell>
                  <TableCell className="text-sm">
                    {e.name_en && e.name_en !== e.name ? (
                      <span title={e.name_en} className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">
                        {e.name || `reg ${e.addr}`}
                      </span>
                    ) : (e.name || `reg ${e.addr}`)}
                  </TableCell>
                  <TableCell className="font-semibold text-sm">
                    {e.text ?? (e.raw != null ? String(e.raw) : "—")}
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Событий не найдено
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {limit < LIMIT_MAX && (data?.events.length ?? 0) >= limit && (
        <div className="text-center">
          <button
            onClick={() => setLimit((l) => Math.min(l + LIMIT_STEP, LIMIT_MAX))}
            className="rounded-md border bg-card px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            Загрузить ещё
          </button>
        </div>
      )}
    </div>
  );
}
