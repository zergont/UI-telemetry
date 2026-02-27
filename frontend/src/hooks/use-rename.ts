import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export function useRenameObject(routerSn: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ ok: boolean }>(`/api/objects/${routerSn}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["object", routerSn] });
      qc.invalidateQueries({ queryKey: ["objects"] });
    },
  });
}

export function useRenameEquipment(
  routerSn: string,
  equipType: string,
  panelId: string | number,
) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ ok: boolean }>(
        `/api/objects/${routerSn}/equipment/${equipType}/${panelId}/name`,
        {
          method: "PATCH",
          body: JSON.stringify({ name }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment", routerSn] });
    },
  });
}
