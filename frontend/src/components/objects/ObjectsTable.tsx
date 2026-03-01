import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { ObjectOut } from "@/hooks/use-objects";
import StatusBadge from "@/components/equipment/StatusBadge";
import { formatRelativeTime } from "@/lib/format";

interface Props {
  objects: ObjectOut[];
  isLoading: boolean;
  focusedSn?: string | null;
  onObjectClick?: (sn: string) => void;
}

export default function ObjectsTable({
  objects,
  isLoading,
  focusedSn,
  onObjectClick,
}: Props) {
  const navigate = useNavigate();

  const handleRowClick = (obj: ObjectOut) => {
    // Если уже в фокусе — переходим на страницу объекта
    if (focusedSn === obj.router_sn) {
      navigate(`/objects/${obj.router_sn}`);
      return;
    }

    // Если объект без координат — сразу переходим
    if (obj.lat == null || obj.lon == null) {
      navigate(`/objects/${obj.router_sn}`);
      return;
    }

    // Первый клик — фокусируем карту
    onObjectClick?.(obj.router_sn);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Объект</TableHead>
            <TableHead className="hidden sm:table-cell">SN</TableHead>
            <TableHead className="text-center">Оборудование</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead className="hidden md:table-cell">
              Обновлено
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {objects.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                Объекты не найдены
              </TableCell>
            </TableRow>
          )}
          {objects.map((obj) => {
            const isFocused = focusedSn === obj.router_sn;
            return (
              <TableRow
                key={obj.router_sn}
                className={`cursor-pointer transition-colors ${
                  isFocused
                    ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => handleRowClick(obj)}
              >
                <TableCell className="font-medium">
                  {obj.name || obj.router_sn}
                </TableCell>
                <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">
                  {obj.router_sn}
                </TableCell>
                <TableCell className="text-center">
                  {obj.equipment_count}
                </TableCell>
                <TableCell>
                  <StatusBadge status={obj.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {obj.updated_at
                    ? formatRelativeTime(obj.updated_at)
                    : "\u2014"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
