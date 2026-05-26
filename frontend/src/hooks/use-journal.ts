import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface JournalEvent {
  ts: string;           // state_start
  addr: number;
  name: string | null;      // русское имя (основное)
  name_en: string | null;   // английское (тултип)
  raw: number | null;   // enum value code
  text: string | null;  // label_ru ?? label ?? str(value)
  state_end: string | null;     // null = текущее активное состояние
  duration_seconds: number | null;
}

export interface JournalResponse {
  events: JournalEvent[];
}

export function useJournal(
  routerSn: string,
  equipType: string,
  panelId: number | string,
  limit = 500,
) {
  return useQuery({
    queryKey: ["journal", routerSn, equipType, panelId, limit],
    queryFn: () =>
      apiFetch<JournalResponse>(
        `/api/history/journal?router_sn=${routerSn}&equip_type=${equipType}&panel_id=${panelId}&limit=${limit}`,
      ),
    enabled: !!routerSn && !!equipType,
  });
}
