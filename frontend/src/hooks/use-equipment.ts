import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

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
  last_update: string | null;
}

export function useEquipment(routerSn: string) {
  return useQuery({
    queryKey: ["equipment", routerSn],
    queryFn: () =>
      apiFetch<EquipmentOut[]>(`/api/objects/${routerSn}/equipment`),
    enabled: !!routerSn,
  });
}
