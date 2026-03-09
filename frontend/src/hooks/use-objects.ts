import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface ObjectOut {
  router_sn: string;
  name: string | null;
  notes: string | null;
  lat: number | null;
  lon: number | null;
  equipment_count: number;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  total_installed_power_kw: number | null;
  total_load_kw: number | null;
}

export function useObjects() {
  return useQuery({
    queryKey: ["objects"],
    queryFn: () => apiFetch<ObjectOut[]>("/api/objects"),
    refetchInterval: 60_000,
  });
}

export function useDeleteObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (routerSn: string) =>
      apiFetch<{ ok: boolean }>(`/api/objects/${routerSn}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objects"] });
    },
  });
}
