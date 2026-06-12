/**
 * Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
 * Программный комплекс «Честная Генерация»
 * Модуль веб-дашборда и визуализации телеметрии
 * Автор: Саввиди Александр Анатольевич | ИНН 4725009270
 *
 * Данное программное обеспечение является конфиденциальным.
 * Несанкционированное копирование, распространение или использование
 * без письменного разрешения правообладателя запрещено.
 */

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

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface FaultItem {
  bit: number;
  name: string;
  severity: string;
}

interface RegisterRow {
  addr: number;
  name: string | null;
  name_en?: string | null;
  notes_ru?: string | null;
  value: number | null;
  raw: number | null;
  text: string | null;
  unit: string | null;
  faults?: FaultItem[] | null;
  receivedAt?: string;
  ts?: string | null;
}

interface RegistersTabProps {
  registers: RegisterRow[];
  isLoading: boolean;
  liveCount: number;
  wsConnected: boolean;
  lastWsUpdate: number | undefined;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Единицы для отображения в колонке «Ед.» */
function displayUnit(unit: string | null): string {
  if (!unit || unit === "fault_bitmap") return "";
  if (unit === "enum") return "enum";
  return unit;
}

/** Цвет бэйджа по severity */
function severityClass(severity: string): string {
  switch (severity) {
    case "warning":
      return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
    case "derate":
      return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
    case "shutdown":
    case "shutdown_cooldown":
      return "bg-red-500/15 text-red-500";
    default:
      return "bg-slate-500/15 text-slate-400";
  }
}

/** Содержимое колонки «Текст» */
function TextContent({ r }: { r: RegisterRow }) {
  const { unit, text, faults, raw } = r;

  if (unit === "fault_bitmap") {
    // Нет описания битов — показываем hex
    if (text) {
      return <span className="font-mono text-xs text-muted-foreground">{text}</span>;
    }
    // Есть описание битов
    if (faults != null) {
      if (faults.length === 0) {
        return raw != null ? (
          <span className="text-xs text-green-500 dark:text-green-400">OK</span>
        ) : null;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {faults.map((f) => (
            <span
              key={f.bit}
              title={`bit ${f.bit} · ${f.severity}`}
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${severityClass(f.severity)}`}
            >
              {f.name}
            </span>
          ))}
        </div>
      );
    }
    return null;
  }

  // enum или числовой с текстом
  return text ? (
    <span className="text-xs text-muted-foreground">{text}</span>
  ) : null;
}

/** Ключ для FlashCell текстовой колонки */
function textFlashKey(r: RegisterRow): unknown {
  if (r.unit === "fault_bitmap" && r.faults != null) {
    return r.faults.map((f) => f.bit).join(",");
  }
  return r.text;
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export default function RegistersTab({
  registers,
  isLoading,
  liveCount,
  wsConnected,
  lastWsUpdate,
}: RegistersTabProps) {
  const [search, setSearch] = useState("");
  const [hideZero, setHideZero] = useState(false);

  const filtered = useMemo(() => {
    let result = registers;
    if (hideZero) {
      result = result.filter((r) => r.raw !== 0);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          String(r.addr).includes(q) ||
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.name_en && r.name_en.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [registers, search, hideZero]);

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
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Поиск по адресу или имени..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
            <input
              type="checkbox"
              checked={hideZero}
              onChange={(e) => setHideZero(e.target.checked)}
              className="rounded"
            />
            Скрывать нулевые
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
          {lastWsUpdate && (
            <span>· {formatRelativeTime(new Date(lastWsUpdate))}</span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="max-h-[600px] overflow-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Адрес</TableHead>
              <TableHead>Имя</TableHead>
              <TableHead className="w-28">Значение</TableHead>
              <TableHead>Текст</TableHead>
              <TableHead className="w-20">Ед.</TableHead>
              <TableHead className="hidden lg:table-cell w-28">Обновлено</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.addr}>
                {/* Адрес */}
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {r.addr}
                </TableCell>

                {/* Имя (русское) + tooltip: английское имя + notes_ru */}
                <TableCell className="text-sm">
                  {(() => {
                    const parts: string[] = [];
                    if (r.name_en && r.name_en !== r.name) parts.push(r.name_en);
                    if (r.notes_ru) parts.push(r.notes_ru);
                    const tooltip = parts.join("\n");
                    return tooltip ? (
                      <span
                        title={tooltip}
                        className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
                      >
                        {r.name || `reg ${r.addr}`}
                      </span>
                    ) : (
                      <span>{r.name || `reg ${r.addr}`}</span>
                    );
                  })()}
                </TableCell>

                {/* Значение (с flash при изменении) */}
                <FlashCell value={r.value} className="font-semibold tabular-nums text-sm">
                  {r.value != null
                    ? (() => {
                        const n = +r.value;
                        return Number.isInteger(n) ? n : parseFloat(n.toFixed(4));
                      })()
                    : "—"}
                </FlashCell>

                {/* Текст: enum-лейбл / fault-бэйджи / hex */}
                <FlashCell value={textFlashKey(r)}>
                  <TextContent r={r} />
                </FlashCell>

                {/* Единицы: числовая / "enum" / пусто для fault_bitmap */}
                <TableCell className="text-xs text-muted-foreground">
                  {displayUnit(r.unit)}
                </TableCell>

                {/* Время последнего обновления */}
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {r.receivedAt
                    ? formatRelativeTime(r.receivedAt)
                    : r.ts
                      ? formatRelativeTime(r.ts)
                      : "—"}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
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
