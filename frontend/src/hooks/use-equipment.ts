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

    // Throttle: не чаще одного рефетча каждые 20 сек.
    // Дебаунс не подходит — WS стреляет каждые 2-5 сек и постоянно
    // сбрасывал бы таймер, так что он никогда не срабатывал.
    const THROTTLE_MS = 20_000;
    // Первый рефетч — с задержкой 3 сек (чтобы cg-bd-writer успел записать в БД).
    const WRITER_DELAY_MS = 3_000;
    let lastFiredAt = 0;
    let pendingId: ReturnType<typeof setTimeout> | null = null;

    const unsub = useTelemetryStore.subscribe((state, prev) => {
      for (const [key, ts] of state.lastUpdate) {
        if (!key.startsWith(`${routerSn}:`)) continue;
        const prevTs = prev.lastUpdate.get(key) ?? 0;
        if (ts > prevTs) {
          const now = Date.now();
          // Throttle: игнорируем, если рефетч был недавно или уже запланирован
          if (pendingId !== null || now - lastFiredAt < THROTTLE_MS) return;
          pendingId = setTimeout(() => {
            pendingId = null;
            lastFiredAt = Date.now();
            qc.invalidateQueries({ queryKey: ["equipment", routerSn] });
          }, WRITER_DELAY_MS);
          return;
        }
      }
    });

    return () => {
      unsub();
      if (pendingId) clearTimeout(pendingId);
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
