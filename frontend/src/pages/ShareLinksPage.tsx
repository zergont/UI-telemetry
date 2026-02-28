import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Copy, Check, Trash2, Plus, Link2, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useIsAdmin } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ShareLink {
  id: number;
  label: string;
  scope_type: string;
  scope_id: string | null;
  role: string;
  max_uses: number | null;
  use_count: number;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string;
  token?: string;
  url?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isExpired(link: ShareLink): boolean {
  if (link.revoked_at) return true;
  if (link.expires_at && new Date(link.expires_at) < new Date()) return true;
  if (link.max_uses != null && link.use_count >= link.max_uses) return true;
  return false;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy} title="Копировать">
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

export default function ShareLinksPage() {
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();

  // Форма создания
  const [label, setLabel] = useState("");
  const [scopeType, setScopeType] = useState("all");
  const [scopeId, setScopeId] = useState("");
  const [expireDays, setExpireDays] = useState("7");

  // Только что созданная ссылка (с токеном)
  const [justCreated, setJustCreated] = useState<ShareLink | null>(null);

  const { data: links, isLoading, isFetching } = useQuery<ShareLink[]>({
    queryKey: ["share-links"],
    queryFn: () => apiFetch<ShareLink[]>("/api/share-links"),
    enabled: isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<ShareLink>("/api/share-links", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["share-links"] });
      setJustCreated(data);
      setLabel("");
      setScopeId("");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ ok: boolean }>(`/api/share-links/${id}/revoke`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share-links"] }),
  });

  const handleCreate = () => {
    createMutation.mutate({
      label: label || "Без названия",
      scope_type: scopeType,
      scope_id: scopeType !== "all" ? scopeId : null,
      expire_days: parseInt(expireDays) || 7,
    });
  };

  if (!isAdmin) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Доступ запрещён. Эта страница доступна только администраторам.
      </div>
    );
  }

  const activeLinks = links?.filter((l) => !isExpired(l)) ?? [];
  const allExpiredLinks = links?.filter((l) => isExpired(l)) ?? [];
  // Показываем только 10 последних неактивных ссылок
  const expiredLinks = allExpiredLinks.slice(-10);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        На главную
      </Link>

      <div className="flex items-center gap-3">
        <Link2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Управление доступом</h1>
      </div>

      {/* Форма создания */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Создать ссылку доступа</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Название</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Для клиента X"
                className="w-48"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Область</label>
              <select
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value)}
                className="rounded-md border bg-card px-3 py-2 text-sm h-9"
              >
                <option value="all">Все объекты</option>
                <option value="site">Один объект</option>
              </select>
            </div>
            {scopeType === "site" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Router SN</label>
                <Input
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  placeholder="6003790403"
                  className="w-36 font-mono"
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Дней</label>
              <Input
                type="number"
                value={expireDays}
                onChange={(e) => setExpireDays(e.target.value)}
                className="w-20"
                min="1"
                max="365"
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Создать
            </Button>
          </div>

          {/* Только что созданная ссылка */}
          {justCreated?.url && (
            <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <p className="text-sm font-medium text-green-600 dark:text-green-400 mb-1">
                Ссылка создана! Скопируйте — токен показывается только один раз.
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-2 py-1 rounded flex-1 overflow-x-auto">
                  {justCreated.url}
                </code>
                <CopyButton text={justCreated.url} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Активные ссылки */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Активные ссылки ({activeLinks.length})
          </CardTitle>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => qc.invalidateQueries({ queryKey: ["share-links"] })}
            disabled={isFetching}
            title="Обновить данные"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Загрузка...</p>
          ) : activeLinks.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">
              Нет активных ссылок
            </p>
          ) : (
            <div className="rounded-lg border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Область</TableHead>
                    <TableHead>Использований</TableHead>
                    <TableHead>Истекает</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeLinks.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell className="font-medium">{link.label || "—"}</TableCell>
                      <TableCell className="text-sm">
                        {link.scope_type === "all"
                          ? "Все объекты"
                          : `Объект: ${link.scope_id}`}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {link.use_count}
                        {link.max_uses != null && ` / ${link.max_uses}`}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(link.expires_at)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-400"
                          onClick={() => revokeMutation.mutate(link.id)}
                          disabled={revokeMutation.isPending}
                          title="Отозвать"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Неактивные ссылки */}
      {expiredLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">
              Неактивные ({allExpiredLinks.length > 10 ? `последние 10 из ${allExpiredLinks.length}` : expiredLinks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-auto opacity-60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Область</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Создана</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiredLinks.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell>{link.label || "—"}</TableCell>
                      <TableCell className="text-sm">
                        {link.scope_type === "all"
                          ? "Все объекты"
                          : `Объект: ${link.scope_id}`}
                      </TableCell>
                      <TableCell className="text-sm">
                        {link.revoked_at
                          ? "Отозвана"
                          : link.max_uses != null && link.use_count >= link.max_uses
                            ? "Лимит исчерпан"
                            : "Просрочена"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(link.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
