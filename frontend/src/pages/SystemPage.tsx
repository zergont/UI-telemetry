import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Plus,
  Trash2,
  Save,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useAdminVersion,
  useAdminUpdateStatus,
  useTriggerAdminUpdate,
  type AdminUpdateStatus,
} from "@/hooks/use-admin-panel";
import {
  useChartSettings,
  useSaveChartSettings,
  DEFAULT_REGISTERS,
  type ChartRegister,
} from "@/hooks/use-chart-settings";

// ─── Константы поллинга (по протоколу cg-admin) ───────────────────────────
const TIMEOUT_MS = 3 * 60_000;
const MAX_IDLE_STREAK = 10;

const STATE_LABELS: Record<string, string> = {
  idle:       "Ожидание...",
  running:    "Обновление...",
  done:       "Завершено",
  error:      "Ошибка",
};

// ─── Палитра цветов для новых регистров ────────────────────────────────────
const COLOR_PALETTE = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#f97316",
];

// ─── Блок обновления cg-admin ──────────────────────────────────────────────
function AdminUpdateBlock() {
  const { data: version, refetch: refetchVersion } = useAdminVersion();
  const triggerMutation = useTriggerAdminUpdate();

  const [polling, setPolling] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [idleStreak, setIdleStreak] = useState(0);
  const deadlineRef = useRef<number>(0);
  const versionBeforeRef = useRef<string>("");
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data: statusData } = useAdminUpdateStatus(polling);

  // Обработка статуса
  useEffect(() => {
    if (!polling || !statusData) return;

    setLog(statusData.log ?? []);

    if (statusData.state === "running") {
      setIdleStreak(0);
    }

    if (statusData.state === "done") {
      setPolling(false);
      refetchVersion().then((res) => {
        const newTag = res.data?.git_tag ?? "";
        if (newTag && newTag !== versionBeforeRef.current) {
          setResultMsg({ ok: true, text: `Обновлено: ${versionBeforeRef.current} → ${newTag}` });
        } else {
          setResultMsg({ ok: true, text: "Завершено, версия не изменилась" });
        }
      });
      return;
    }

    if (statusData.state === "error") {
      setPolling(false);
      setResultMsg({ ok: false, text: statusData.error ?? "Неизвестная ошибка" });
      return;
    }

    if (statusData.state === "idle") {
      setIdleStreak((n) => {
        const next = n + 1;
        if (next > MAX_IDLE_STREAK) {
          setPolling(false);
          setResultMsg({ ok: false, text: "Деплой не начался или завершился без статуса" });
        }
        return next;
      });
    }

    // Таймаут
    if (Date.now() > deadlineRef.current) {
      setPolling(false);
      setResultMsg({ ok: false, text: "Таймаут обновления (3 минуты)" });
    }
  }, [statusData, polling, refetchVersion]);

  // Авто-скролл лога
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length]);

  const handleUpdate = () => {
    versionBeforeRef.current = version?.git_tag ?? "";
    deadlineRef.current = Date.now() + TIMEOUT_MS;
    setLog([]);
    setResultMsg(null);
    setIdleStreak(0);
    triggerMutation.mutate(undefined, {
      onSuccess: () => setPolling(true),
      onError: (e) => setResultMsg({ ok: false, text: String(e) }),
    });
  };

  const displayState: string = statusData?.state ?? "idle";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ExternalLink className="h-4 w-4" />
          Панель управления (cg-admin)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Версия + ссылка */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {version ? (
              <span>
                Версия:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {version.git_tag}
                </span>{" "}
                <span className="font-mono text-xs">({version.commit})</span>
              </span>
            ) : (
              <span className="italic">Недоступна</span>
            )}
          </div>
          <a
            href={`${window.location.protocol}//${window.location.hostname}:9443/admin/`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Открыть
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Кнопка обновить */}
        <Button
          onClick={handleUpdate}
          disabled={polling || triggerMutation.isPending || !version}
          variant="outline"
          size="sm"
        >
          {polling || triggerMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Обновить cg-admin
        </Button>

        {/* Результат */}
        {resultMsg && (
          <div
            className={`flex items-center gap-2 text-sm ${
              resultMsg.ok ? "text-green-600" : "text-red-500"
            }`}
          >
            {resultMsg.ok ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {resultMsg.text}
          </div>
        )}

        {/* Лог */}
        {(polling || log.length > 0) && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {polling && <Loader2 className="h-3 w-3 animate-spin" />}
              {STATE_LABELS[displayState] ?? displayState}
            </div>
            <div className="border rounded-md p-3 bg-black/90 text-green-400 font-mono text-xs max-h-48 overflow-y-auto">
              {log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Блок настроек графика ─────────────────────────────────────────────────
function ChartSettingsBlock() {
  const { data: saved = DEFAULT_REGISTERS } = useChartSettings();
  const saveMutation = useSaveChartSettings();

  const [items, setItems] = useState<ChartRegister[]>(saved);
  const [saved_, setSaved_] = useState(false);

  // Синхронизируем с сервером при первой загрузке
  useEffect(() => {
    setItems(saved);
  }, [saved]);

  const update = (idx: number, field: keyof ChartRegister, value: string | number) => {
    setItems((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    );
    setSaved_(false);
  };

  const remove = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setSaved_(false);
  };

  const add = () => {
    const usedColors = new Set(items.map((r) => r.color));
    const color = COLOR_PALETTE.find((c) => !usedColors.has(c)) ?? COLOR_PALETTE[0];
    setItems((prev) => [
      ...prev,
      { addr: 0, label: "Новый параметр", unit: "", color },
    ]);
    setSaved_(false);
  };

  const save = () => {
    saveMutation.mutate(items, {
      onSuccess: () => setSaved_(true),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Настройки графика</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Параметры, доступные для выбора во вкладке «График».
        </p>

        <div className="space-y-2">
          {items.map((r, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {/* Цвет */}
              <input
                type="color"
                value={r.color}
                onChange={(e) => update(idx, "color", e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border bg-transparent p-0.5"
                title="Цвет линии"
              />
              {/* Адрес */}
              <Input
                type="number"
                value={r.addr || ""}
                onChange={(e) => update(idx, "addr", parseInt(e.target.value) || 0)}
                placeholder="Адрес"
                className="w-24 font-mono text-sm"
              />
              {/* Название */}
              <Input
                value={r.label}
                onChange={(e) => update(idx, "label", e.target.value)}
                placeholder="Название"
                className="flex-1 text-sm"
              />
              {/* Единица */}
              <Input
                value={r.unit}
                onChange={(e) => update(idx, "unit", e.target.value)}
                placeholder="Ед."
                className="w-16 text-sm"
              />
              {/* Удалить */}
              <button
                onClick={() => remove(idx)}
                className="text-muted-foreground hover:text-red-500 transition-colors"
                title="Удалить"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="h-4 w-4 mr-1.5" />
            Добавить
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1.5" />
            )}
            Сохранить
          </Button>
          {saved_ && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Сохранено
            </span>
          )}
          {saveMutation.isError && (
            <span className="flex items-center gap-1 text-sm text-red-500">
              <AlertCircle className="h-4 w-4" />
              Ошибка сохранения
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Основная страница ─────────────────────────────────────────────────────
export default function SystemPage() {
  const isAdmin = useIsAdmin();

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Доступ запрещён
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Система</h1>
      </div>

      <AdminUpdateBlock />
      <ChartSettingsBlock />
    </div>
  );
}
