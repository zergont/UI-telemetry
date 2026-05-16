import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface AdminUpdateCheck {
  current: string;
  latest: string | null;
  has_update: boolean;
  commit: string;
}

export interface AdminVersion {
  version: string;
  git_tag: string;
  commit: string;
}

export interface AdminUpdateStatus {
  state: "idle" | "running" | "done" | "error";
  progress: string;
  log: string[];
  error: string | null;
}

export function useAdminVersion(enabled = true) {
  return useQuery<AdminVersion>({
    queryKey: ["admin-version"],
    queryFn: () => apiFetch<AdminVersion>("/api/admin/version"),
    staleTime: 60_000,
    retry: false,
    enabled,
  });
}

export function useAdminUpdateStatus(enabled: boolean) {
  return useQuery<AdminUpdateStatus>({
    queryKey: ["admin-update-status"],
    queryFn: () => apiFetch<AdminUpdateStatus>("/api/admin/update-status"),
    refetchInterval: enabled ? 2_000 : false,
    retry: 3,
    enabled,
  });
}

export function useTriggerAdminUpdate() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; message: string }>("/api/admin/update", {
        method: "POST",
      }),
  });
}

export function useCheckAdminUpdate() {
  return useMutation({
    mutationFn: () => apiFetch<AdminUpdateCheck>("/api/admin/check-update"),
  });
}
