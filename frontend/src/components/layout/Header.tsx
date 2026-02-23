import { Link, useLocation } from "react-router-dom";
import { Moon, Sun, Zap, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { useTelemetryStore } from "@/stores/telemetry-store";

export default function Header() {
  const { theme, toggleTheme } = useTheme();
  const connected = useTelemetryStore((s) => s.connected);
  const location = useLocation();

  const crumbs = buildBreadcrumbs(location.pathname);

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

function buildBreadcrumbs(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];

  if (parts[0] === "objects" && parts[1]) {
    crumbs.push({ label: parts[1], path: `/objects/${parts[1]}` });

    if (parts[2] === "equipment" && parts[3] && parts[4]) {
      crumbs.push({
        label: `${parts[3]} #${parts[4]}`,
        path: `/objects/${parts[1]}/equipment/${parts[3]}/${parts[4]}`,
      });
    }
  }

  return crumbs;
}
