import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface JournalEvent {
  ts: string;
  addr: number;
  name: string | null;
  raw: number | null;
  text: string | null;
  write_reason: string | null;
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
