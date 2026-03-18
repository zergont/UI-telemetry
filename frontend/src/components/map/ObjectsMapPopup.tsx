import type { ObjectOut } from "@/hooks/use-objects";
import { getStatusMeta } from "@/lib/status";

interface ObjectsMapPopupProps {
  object: ObjectOut;
  onDive?: (sn: string) => void;
  onNavigate: (sn: string) => void;
  onClose: () => void;
}

function getLoadTone(loadPct: number | null) {
  if (loadPct == null) {
    return {
      textClassName: "text-foreground",
      barClassName: "bg-blue-500",
    };
  }
  if (loadPct > 85) {
    return { textClassName: "text-red-400", barClassName: "bg-red-500" };
  }
  if (loadPct > 65) {
    return { textClassName: "text-amber-400", barClassName: "bg-amber-400" };
  }
  return { textClassName: "text-foreground", barClassName: "bg-blue-500" };
}

export default function ObjectsMapPopup({
  object,
  onDive,
  onNavigate,
  onClose,
}: ObjectsMapPopupProps) {
  const loadPct =
    object.total_installed_power_kw != null &&
    object.total_installed_power_kw > 0 &&
    object.total_load_kw != null
      ? Math.round((object.total_load_kw / object.total_installed_power_kw) * 100)
      : null;
  const statusMeta = getStatusMeta(object.status);
  const loadTone = getLoadTone(loadPct);

  const handleOpen = () => {
    if (onDive) {
      onDive(object.router_sn);
      return;
    }
    onNavigate(object.router_sn);
  };

  return (
    <div className="cursor-pointer select-none" onClick={handleOpen}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight font-semibold">
            {object.name || object.router_sn}
          </p>
          {object.name && (
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {object.router_sn}
            </p>
          )}
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.badgeClassName}`}>
          {statusMeta.shortLabel}
        </span>
        <button
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {object.total_installed_power_kw != null ? (
        <>
          <div className="mb-2 h-px bg-border" />
          <div className="mb-2">
            <div className="mb-1 flex justify-between items-baseline">
              <span className="text-[11px] text-muted-foreground">Нагрузка</span>
              {loadPct != null && (
                <span className={`text-[11px] font-semibold tabular-nums ${loadTone.textClassName}`}>
                  {loadPct}%
                </span>
              )}
            </div>
            {loadPct != null && (
              <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all ${loadTone.barClassName}`}
                  style={{ width: `${Math.min(loadPct, 100)}%` }}
                />
              </div>
            )}
            <div className="text-right tabular-nums">
              <span className="text-[11px] font-medium">
                {object.total_load_kw != null ? object.total_load_kw.toFixed(0) : "—"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {" / "}
                {Math.round(object.total_installed_power_kw)} кВт
              </span>
            </div>
          </div>
        </>
      ) : null}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {object.equipment_count} {object.equipment_count === 1 ? "установка" : "установки"}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Открыть
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 5h6M5 2l3 3-3 3" />
          </svg>
        </span>
      </div>
    </div>
  );
}
