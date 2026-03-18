import { useMemo, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/format";
import FlashCell from "./FlashCell";

interface RegisterRow {
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
}

interface RegistersTabProps {
  registers: RegisterRow[];
  isLoading: boolean;
  liveCount: number;
  wsConnected: boolean;
  lastWsUpdate: number | undefined;
}

export default function RegistersTab({
  registers,
  isLoading,
  liveCount,
  wsConnected,
  lastWsUpdate,
}: RegistersTabProps) {
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
        (r) => String(r.addr).includes(q) || (r.name && r.name.toLowerCase().includes(q)),
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Поиск по адресу или имени..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
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
            <Wifi className="h-3.5 w-3.5 text-blue-500" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-slate-400" />
          )}
          <span>
            {wsConnected ? "WS подключён" : "WS отключён"}
            {liveCount > 0 && ` · ${liveCount} live`}
          </span>
          {lastWsUpdate && <span>· {formatRelativeTime(new Date(lastWsUpdate))}</span>}
        </div>
      </div>

      <div className="max-h-[600px] overflow-auto rounded-xl border bg-card">
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
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
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
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
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
