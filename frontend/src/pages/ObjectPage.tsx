import { useParams, Link } from "react-router-dom";
import { ArrowLeft, MapPin, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useEquipment } from "@/hooks/use-equipment";
import type { ObjectOut } from "@/hooks/use-objects";
import { useTelemetryStore } from "@/stores/telemetry-store";
import DguCard from "@/components/equipment/DguCard";
import DguCardSkeleton from "@/components/equipment/DguCardSkeleton";
import StatusBadge from "@/components/equipment/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";

export default function ObjectPage() {
  const { routerSn } = useParams<{ routerSn: string }>();
  const drift = useTelemetryStore((s) => s.drifts.get(routerSn!));

  const { data: object, isLoading: objLoading } = useQuery({
    queryKey: ["object", routerSn],
    queryFn: () => apiFetch<ObjectOut>(`/api/objects/${routerSn}`),
    enabled: !!routerSn,
  });

  const { data: equipment, isLoading: eqLoading } = useEquipment(routerSn!);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Все объекты
          </Link>
          {objLoading ? (
            <Skeleton className="h-8 w-64" />
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">
                {object?.name || routerSn}
              </h1>
              <StatusBadge status={object?.status || "OFFLINE"} />
            </div>
          )}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="font-mono">{routerSn}</span>
            {object?.lat != null && object?.lon != null && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {object.lat.toFixed(4)}, {object.lon.toFixed(4)}
              </span>
            )}
            {drift != null && (
              <span
                className={`flex items-center gap-1 ${
                  Math.abs(drift) > 10
                    ? "text-amber-500"
                    : "text-muted-foreground"
                }`}
                title={`Разница часов сервера и браузера: ${drift > 0 ? "+" : ""}${drift} сек. ${Math.abs(drift) > 10 ? "Рекомендуется синхронизировать NTP" : ""}`}
              >
                <Clock className="h-3 w-3" />
                drift {drift > 0 ? "+" : ""}{drift}с
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Equipment grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {eqLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <DguCardSkeleton key={i} />
            ))
          : equipment?.map((eq) => (
              <DguCard
                key={`${eq.equip_type}:${eq.panel_id}`}
                equipment={eq}
              />
            ))}
        {!eqLoading && equipment?.length === 0 && (
          <p className="text-muted-foreground col-span-full text-center py-8">
            Оборудование не найдено
          </p>
        )}
      </div>
    </div>
  );
}
