import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Moon, Sun, Zap, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { ObjectOut } from "@/hooks/use-objects";
import type { EquipmentOut } from "@/hooks/use-equipment";

/** Разбор URL для определения routerSn / equipType / panelId */
function parseRoute(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const routerSn = parts[0] === "objects" && parts[1] ? parts[1] : undefined;
  const equipType =
    routerSn && parts[2] === "equipment" && parts[3] ? parts[3] : undefined;
  const panelId = equipType && parts[4] ? parts[4] : undefined;
  return { routerSn, equipType, panelId };
}

export default function Header() {
  const { theme, toggleTheme } = useTheme();
  const connected = useTelemetryStore((s) => s.connected);
  const location = useLocation();

  const { routerSn, equipType, panelId } = useMemo(
    () => parseRoute(location.pathname),
    [location.pathname],
  );

  // Подгружаем имя объекта (используется кэш, без лишних запросов)
  const { data: object } = useQuery({
    queryKey: ["object", routerSn],
    queryFn: () => apiFetch<ObjectOut>(`/api/objects/${routerSn}`),
    enabled: !!routerSn,
    staleTime: 60_000,
  });

  // Подгружаем список оборудования (используется кэш)
  const { data: eqList } = useQuery({
    queryKey: ["equipment", routerSn],
    queryFn: () =>
      apiFetch<EquipmentOut[]>(`/api/objects/${routerSn}/equipment`),
    enabled: !!routerSn && !!equipType,
    staleTime: 60_000,
  });

  const crumbs = useMemo(() => {
    const result: { label: string; path: string }[] = [];
    if (!routerSn) return result;

    result.push({
      label: object?.name || routerSn,
      path: `/objects/${routerSn}`,
    });

    if (equipType && panelId) {
      const eq = eqList?.find(
        (e) => e.equip_type === equipType && String(e.panel_id) === panelId,
      );
      result.push({
        label: eq?.name || `${equipType} #${panelId}`,
        path: `/objects/${routerSn}/equipment/${equipType}/${panelId}`,
      });
    }

    return result;
  }, [routerSn, equipType, panelId, object, eqList]);

  return (
    <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Zap className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline">Честная Генерация</span>
          </Link>

          {crumbs.length > 0 && (
            <nav className="flex items-center gap-1 text-sm text-muted-foreground">
              {crumbs.map((c, i) => (
                <span key={c.path} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3" />
                  {i === crumbs.length - 1 ? (
                    <span className="text-foreground">{c.label}</span>
                  ) : (
                    <Link
                      to={c.path}
                      className="hover:text-foreground transition-colors"
                    >
                      {c.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-amber-500 animate-pulse"}`}
            />
            <span className="text-muted-foreground">
              {connected ? "Online" : "Connecting..."}
            </span>
          </div>

          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
