import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useTelemetryStore } from "@/stores/telemetry-store";

export interface EquipmentOut {
  router_sn: string;
  equip_type: string;
  panel_id: number;
  name: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  installed_power_kw: number | null;
  current_load_kw: number | null;
  engine_hours: number | null;
  oil_temp_c: number | null;
  oil_pressure_kpa: number | null;
  engine_state: string;
  connection_status: string;
  last_update: string | null;
}

export function useEquipment(routerSn: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!routerSn) return;

    let debounceId: ReturnType<typeof setTimeout> | null = null;

    // Zustand vanilla subscribe — не вызывает ре-рендер компонента.
    // Когда приходит новая телеметрия для нашего router_sn,
    // ждём 3 сек (чтобы cg-bd-writer успел записать в БД) и инвалидируем кэш.
    const unsub = useTelemetryStore.subscribe((state, prev) => {
      for (const [key, ts] of state.lastUpdate) {
        if (!key.startsWith(`${routerSn}:`)) continue;
        const prevTs = prev.lastUpdate.get(key) ?? 0;
        if (ts > prevTs) {
          if (debounceId) clearTimeout(debounceId);
          debounceId = setTimeout(() => {
            qc.invalidateQueries({ queryKey: ["equipment", routerSn] });
          }, 3_000);
          return;
        }
      }
    });

    return () => {
      unsub();
      if (debounceId) clearTimeout(debounceId);
    };
  }, [routerSn, qc]);

  return useQuery({
    queryKey: ["equipment", routerSn],
    queryFn: () =>
      apiFetch<EquipmentOut[]>(`/api/objects/${routerSn}/equipment`),
    enabled: !!routerSn,
    refetchInterval: 60_000, // фолбэк при отключённом WS
  });
}
