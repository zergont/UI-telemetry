import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface DguCardParam {
  addr: number;
  label: string;
  unit: string;
  decimals: number;
}

const QUERY_KEY = ["dgu-card-settings"];

export const DEFAULT_DGU_PARAMS: DguCardParam[] = [
  { addr: 43019, label: "Мощность уст.", unit: "кВт", decimals: 0 },
  { addr: 40034, label: "Нагрузка",      unit: "кВт", decimals: 1 },
  { addr: 40070, label: "Моточасы",      unit: "ч",   decimals: 0 },
  { addr: 40063, label: "t масла",        unit: "°C",  decimals: 1 },
  { addr: 40062, label: "P масла",        unit: "кПа", decimals: 0 },
];

export function useDguCardSettings() {
  return useQuery<DguCardParam[]>({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<DguCardParam[]>("/api/dgu-card-settings"),
    staleTime: 5 * 60_000,
    placeholderData: DEFAULT_DGU_PARAMS,
  });
}

export function useSaveDguCardSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: DguCardParam[]) =>
      apiFetch<DguCardParam[]>("/api/dgu-card-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }),
    onSuccess: (data) => {
      qc.setQueryData(QUERY_KEY, data);
    },
  });
}
