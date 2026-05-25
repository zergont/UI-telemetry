import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface FaultItem {
  bit: number;
  name: string;
  severity: string;
}

export interface RegisterOut {
  addr: number;
  name: string | null;
  name_en?: string | null;
  value: number | null;
  raw: number | null;
  text: string | null;
  unit: string | null;
  faults?: FaultItem[] | null;
  notes_ru?: string | null;
  reason?: string | null;
  ts?: string | null;
  updated_at?: string | null;
}

export function useRegisters(
  routerSn: string,
  equipType: string,
  panelId: number | string,
) {
  return useQuery({
    queryKey: ["registers", routerSn, equipType, panelId],
    queryFn: () =>
      apiFetch<RegisterOut[]>(
        `/api/registers/${routerSn}/${equipType}/${panelId}`,
      ),
    enabled: !!routerSn && !!equipType,
  });
}
