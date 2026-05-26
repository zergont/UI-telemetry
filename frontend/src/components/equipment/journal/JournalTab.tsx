import { useMemo, useState } from "react";
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

export default function JournalTab({ routerSn, equipType, panelId }: JournalTabProps) {
  const [limit, setLimit] = useState(LIMIT_STEP);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useJournal(routerSn, equipType, panelId, limit);

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
      </div>

      <div className="max-h-[600px] overflow-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden lg:table-cell w-44">Начало</TableHead>
              <TableHead className="hidden lg:table-cell w-44">Конец</TableHead>
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
                  <TableCell className="font-mono text-xs">{e.addr}</TableCell>
                  <TableCell className="text-sm">{e.name || `reg ${e.addr}`}</TableCell>
                  <TableCell className="font-semibold text-sm">
                    {e.text ?? (e.raw != null ? String(e.raw) : "—")}
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
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
