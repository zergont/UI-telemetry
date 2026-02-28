import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  GitCommit,
  GitBranch,
  Tag,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useIsAdmin } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface VersionInfo {
  version: string;
  commit: string;
  branch: string;
}

interface UpdateCheck {
  up_to_date: boolean;
  behind_count?: number;
  commits?: { hash: string; message: string }[];
  error?: string;
}

interface UpdateStatus {
  state: string;
  progress: string;
  log: string[];
  error: string | null;
  available: UpdateCheck | null;
}

const STATE_LABELS: Record<string, string> = {
  idle: "Готов",
  checking: "Проверяю...",
  pulling: "Загружаю обновления...",
  installing: "Установка зависимостей...",
  building: "Сборка фронтенда...",
  restarting: "Перезапуск...",
  done: "Обновлено",
  error: "Ошибка",
};

export default function SystemPage() {
  const isAdmin = useIsAdmin();
  const [polling, setPolling] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Current version
  const { data: version } = useQuery<VersionInfo>({
    queryKey: ["system-version"],
    queryFn: () => apiFetch("/api/system/version"),
    staleTime: 60_000,
  });

  // Check for updates
  const checkMutation = useMutation<UpdateCheck>({
    mutationFn: () => apiFetch("/api/system/check-update"),
  });

  // Trigger update
  const updateMutation = useMutation({
    mutationFn: () => apiFetch("/api/system/update", { method: "POST" }),
    onSuccess: () => setPolling(true),
  });

  // Poll update status
  const { data: status } = useQuery<UpdateStatus>({
    queryKey: ["update-status"],
    queryFn: () => apiFetch("/api/system/update-status"),
    refetchInterval: polling ? 1000 : false,
    enabled: isAdmin && polling,
  });

  // Save log lines as they come in (before backend dies)
  useEffect(() => {
    if (status?.log?.length) {
      setUpdateLog(status.log);
    }
  }, [status?.log?.length]);

  // Detect "done" state → backend is about to restart via SIGTERM
  useEffect(() => {
    if (status?.state === "done" && polling) {
      setPolling(false);
      setRestarting(true);
      setUpdateLog((prev) => [...prev, "Перезапуск сервера..."]);

      // Wait for backend to come back, then reload page
      let attempt = 0;
      const maxAttempts = 30; // 30 seconds max
      const timer = setInterval(async () => {
        attempt++;
        try {
          const res = await fetch("/api/system/version");
          if (res.ok) {
            clearInterval(timer);
            setUpdateLog((prev) => [...prev, "Сервер перезапущен! Обновляю страницу..."]);
            setTimeout(() => window.location.reload(), 500);
          }
        } catch {
          // Backend still down, keep trying
        }
        if (attempt >= maxAttempts) {
          clearInterval(timer);
          setRestarting(false);
          setUpdateLog((prev) => [...prev, "Таймаут ожидания рестарта. Обновите страницу вручную."]);
        }
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [status?.state, polling]);

  // Handle error state
  useEffect(() => {
    if (status?.state === "error" && polling) {
      setPolling(false);
    }
  }, [status?.state, polling]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [updateLog.length]);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Доступ запрещён
      </div>
    );
  }

  const isUpdating =
    restarting || (status?.state && !["idle", "done", "error"].includes(status.state));

  const checkData = checkMutation.data;

  // Combined display state
  const displayState = restarting ? "restarting" : status?.state || "idle";
  const showProgress = restarting || (status && status.state !== "idle");

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Система</h1>
      </div>

      {/* Current version */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Текущая версия</CardTitle>
        </CardHeader>
        <CardContent>
          {version ? (
            <div className="flex flex-wrap gap-6 text-sm">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Версия:</span>
                <span className="font-mono font-semibold">{version.version}</span>
              </div>
              <div className="flex items-center gap-2">
                <GitCommit className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Коммит:</span>
                <span className="font-mono">{version.commit}</span>
              </div>
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Ветка:</span>
                <span className="font-mono">{version.branch}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Загрузка...</div>
          )}
        </CardContent>
      </Card>

      {/* Check for updates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Обновления</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending || !!isUpdating}
              variant="outline"
            >
              {checkMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Проверить обновления
            </Button>

            {checkData && checkData.up_to_date && !checkData.error && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Актуальная версия
              </div>
            )}

            {checkData && checkData.error && (
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircle className="h-4 w-4" />
                {checkData.error}
              </div>
            )}
          </div>

          {/* Available updates */}
          {checkData && !checkData.up_to_date && checkData.commits && (
            <div className="space-y-3">
              <div className="text-sm font-medium">
                Доступно обновлений: {checkData.behind_count}
              </div>

              <div className="border rounded-md p-3 bg-muted/30 max-h-48 overflow-y-auto">
                {checkData.commits.map((c) => (
                  <div key={c.hash} className="flex gap-2 text-sm py-1">
                    <span className="font-mono text-muted-foreground shrink-0">
                      {c.hash}
                    </span>
                    <span>{c.message}</span>
                  </div>
                ))}
              </div>

              <Button
                onClick={() => updateMutation.mutate()}
                disabled={!!isUpdating || updateMutation.isPending}
              >
                {updateMutation.isPending || isUpdating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Обновить
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Update progress */}
      {showProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {displayState === "error" ? (
                <AlertCircle className="h-4 w-4 text-red-500" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {STATE_LABELS[displayState] || displayState}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Progress log */}
            <div className="border rounded-md p-3 bg-black/90 text-green-400 font-mono text-xs max-h-64 overflow-y-auto">
              {updateLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              <div ref={logEndRef} />
            </div>

            {status?.error && (
              <div className="mt-3 text-sm text-red-500">{status.error}</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
