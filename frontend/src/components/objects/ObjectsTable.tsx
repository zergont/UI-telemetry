import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { ObjectOut } from "@/hooks/use-objects";
import { useDeleteObject } from "@/hooks/use-objects";
import { useIsAdmin } from "@/hooks/use-auth";
import StatusBadge from "@/components/equipment/StatusBadge";
import { formatRelativeTime } from "@/lib/format";

interface Props {
  objects: ObjectOut[];
  isLoading: boolean;
  focusedSn?: string | null;
  onObjectClick?: (sn: string) => void;
  onObjectDive?: (sn: string) => void;
}

export default function ObjectsTable({
  objects,
  isLoading,
  focusedSn,
  onObjectClick,
  onObjectDive,
}: Props) {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const deleteMut = useDeleteObject();
  const [deleteTarget, setDeleteTarget] = useState<ObjectOut | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await deleteMut.mutateAsync(deleteTarget.router_sn);
      setDeleteTarget(null);
    } catch (err: any) {
      // Попытаемся вытащить detail из ответа
      const body = err?.body ?? err?.message ?? "Ошибка удаления";
      try {
        const parsed = JSON.parse(body);
        setDeleteError(parsed.detail ?? body);
      } catch {
        setDeleteError(body);
      }
    }
  };

  const handleRowClick = (obj: ObjectOut) => {
    // Если уже в фокусе — "ныряем" в объект с анимацией
    if (focusedSn === obj.router_sn) {
      if (obj.lat != null && obj.lon != null && onObjectDive) {
        onObjectDive(obj.router_sn);
      } else {
        navigate(`/objects/${obj.router_sn}`);
      }
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

  const colSpan = isAdmin ? 8 : 7;

  return (
    <>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Объект</TableHead>
              <TableHead className="hidden sm:table-cell">SN</TableHead>
              <TableHead className="hidden lg:table-cell text-right">Мощность уст.</TableHead>
              <TableHead className="hidden lg:table-cell text-right">Нагрузка</TableHead>
              <TableHead className="text-center">Оборудование</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="hidden md:table-cell">
                Обновлено
              </TableHead>
              {isAdmin && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {objects.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
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
                  <TableCell className="hidden lg:table-cell text-right text-sm tabular-nums">
                    {obj.total_installed_power_kw != null
                      ? `${Math.round(obj.total_installed_power_kw)} кВт`
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-right text-sm tabular-nums">
                    {obj.total_load_kw != null
                      ? (
                        <span>
                          {obj.total_load_kw.toFixed(1)} кВт
                          {obj.total_installed_power_kw != null && obj.total_installed_power_kw > 0 && (
                            <span className="text-muted-foreground text-xs ml-1">
                              ({Math.round(obj.total_load_kw / obj.total_installed_power_kw * 100)}%)
                            </span>
                          )}
                        </span>
                      )
                      : <span className="text-muted-foreground">—</span>}
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
                  {isAdmin && (
                    <TableCell className="px-1">
                      <button
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Удалить объект"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteError(null);
                          setDeleteTarget(obj);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Модалка подтверждения удаления */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удаление объекта</DialogTitle>
            <DialogDescription>
              Вы собираетесь удалить объект{" "}
              <strong>{deleteTarget?.name || deleteTarget?.router_sn}</strong>{" "}
              и все связанные данные (оборудование, история, события).
              Это действие необратимо.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
            <p className="font-medium mb-1">Перед удалением убедитесь:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>Передача данных от объекта остановлена</li>
              <li>С момента последних данных прошло не менее 30 минут</li>
            </ul>
          </div>

          {deleteError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
              {deleteError}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Отмена</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Удаление..." : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
