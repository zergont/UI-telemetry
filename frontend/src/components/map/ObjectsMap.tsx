import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Map, {
  Marker,
  NavigationControl,
  Popup,
} from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ObjectOut } from "@/hooks/use-objects";
import { useTheme } from "@/hooks/use-theme";
import DguMarker from "./DguMarker";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Провайдеры карт
// ---------------------------------------------------------------------------

export type MapProvider = "carto" | "maptiler" | "openfreemap";

const MAPTILER_KEY = "7rleXA0jqiQBKMYrXAs3";

const MAP_STYLES: Record<MapProvider, Record<string, string>> = {
  carto: {
    dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  },
  maptiler: {
    dark: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`,
    light: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
  },
  openfreemap: {
    dark: "https://tiles.openfreemap.org/styles/positron",
    light: "https://tiles.openfreemap.org/styles/liberty",
  },
};

export const MAP_PROVIDER_LABELS: Record<MapProvider, string> = {
  carto: "CartoDB",
  maptiler: "MapTiler",
  openfreemap: "OpenFreeMap",
};

/** Получить сохранённый провайдер карт из localStorage */
export function getMapProvider(): MapProvider {
  if (typeof window === "undefined") return "maptiler";
  return (localStorage.getItem("cg-map-provider") as MapProvider) || "maptiler";
}

/** Сохранить провайдер карт */
export function setMapProvider(p: MapProvider) {
  localStorage.setItem("cg-map-provider", p);
}

// ---------------------------------------------------------------------------
// Компонент карты
// ---------------------------------------------------------------------------

interface Props {
  objects: ObjectOut[];
  isLoading: boolean;
  focusedSn?: string | null;
  onFocusChange?: (sn: string | null) => void;
  divingSn?: string | null;
  onDive?: (sn: string) => void;
}

export default function ObjectsMap({
  objects,
  isLoading,
  focusedSn,
  onFocusChange,
  divingSn,
  onDive,
}: Props) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const mapRef = useRef<MapRef>(null);
  const [popup, setPopup] = useState<ObjectOut | null>(null);
  const fittedRef = useRef(false);
  const mapLoadedRef = useRef(false);
  const [provider, setProvider] = useState<MapProvider>(getMapProvider);

  const handleMarkerClick = useCallback(
    (obj: ObjectOut) => {
      // Повторный клик по уже выбранному маркеру — ныряем
      if (focusedSn === obj.router_sn && onDive) {
        onDive(obj.router_sn);
        return;
      }
      setPopup(obj);
      onFocusChange?.(obj.router_sn);
    },
    [focusedSn, onFocusChange, onDive],
  );

  const handleProviderChange = useCallback((p: MapProvider) => {
    setProvider(p);
    setMapProvider(p);
    // Сбросить fit — карта перерисуется с новым стилем
    fittedRef.current = false;
    mapLoadedRef.current = false;
  }, []);

  const styles = MAP_STYLES[provider];
  const mapStyle = theme === "dark" ? styles.dark : styles.light;

  // Объекты с координатами
  const geoObjects = useMemo(
    () => objects.filter((o) => o.lat != null && o.lon != null),
    [objects],
  );

  const markers = useMemo(
    () =>
      geoObjects.map((obj) => (
        <Marker
          key={obj.router_sn}
          longitude={obj.lon!}
          latitude={obj.lat!}
          anchor="center"
        >
          <DguMarker
            status={obj.status}
            onClick={() => handleMarkerClick(obj)}
          />
        </Marker>
      )),
    [geoObjects, handleMarkerClick],
  );

  // Фокусировка карты на объектах
  const fitToObjects = useCallback(() => {
    if (fittedRef.current || geoObjects.length === 0) return;
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    fittedRef.current = true;

    if (geoObjects.length === 1) {
      map.flyTo({
        center: [geoObjects[0].lon!, geoObjects[0].lat!],
        zoom: 7,
        duration: 800,
      });
      return;
    }

    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const o of geoObjects) {
      if (o.lon! < minLng) minLng = o.lon!;
      if (o.lon! > maxLng) maxLng = o.lon!;
      if (o.lat! < minLat) minLat = o.lat!;
      if (o.lat! > maxLat) maxLat = o.lat!;
    }

    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80, maxZoom: 7, duration: 800 },
    );
  }, [geoObjects]);

  // Пробуем фокусировку при изменении объектов
  useEffect(() => {
    fitToObjects();
  }, [fitToObjects]);

  // Карта загрузилась — пробуем фокусировку
  const handleMapLoad = useCallback(() => {
    mapLoadedRef.current = true;
    fitToObjects();
  }, [fitToObjects]);

  // Фокусировка на объекте при выборе из таблицы
  useEffect(() => {
    if (!focusedSn || !mapLoadedRef.current) return;
    const map = mapRef.current;
    if (!map) return;

    const obj = geoObjects.find((o) => o.router_sn === focusedSn);
    if (!obj || obj.lat == null || obj.lon == null) return;

    map.flyTo({
      center: [obj.lon, obj.lat],
      zoom: 10,
      duration: 800,
    });
    setPopup(obj);
  }, [focusedSn, geoObjects]);

  // "Ныряние" в объект — zoom до максимума, потом навигация
  const [isDiving, setIsDiving] = useState(false);

  useEffect(() => {
    if (!divingSn || !mapLoadedRef.current) return;
    const map = mapRef.current;
    if (!map) return;

    const obj = geoObjects.find((o) => o.router_sn === divingSn);
    if (!obj || obj.lat == null || obj.lon == null) {
      navigate(`/objects/${divingSn}`);
      return;
    }

    setIsDiving(true);
    setPopup(null);

    // Закрываем popup и летим с максимальным зумом
    const DIVE_MS = 800;
    // ease-in: зум разгоняется к концу — эффект «проваливания»
    // Навигация на 85% — зум ещё ускоряется, overlay уже тёмный
    const NAV_AT = Math.round(DIVE_MS * 0.85);
    map.flyTo({
      center: [obj.lon, obj.lat],
      zoom: 20,
      duration: DIVE_MS,
      essential: true,
      easing: (t: number) => t * t,
    });

    const timer = setTimeout(() => {
      navigate(`/objects/${divingSn}`);
    }, NAV_AT);

    return () => {
      clearTimeout(timer);
    };
  }, [divingSn, geoObjects, navigate]);

  if (isLoading) {
    return <Skeleton className="h-full w-full rounded-xl" />;
  }

  return (
    <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        key={provider}
        initialViewState={{
          longitude: 37.6,
          latitude: 55.75,
          zoom: 4,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        onLoad={handleMapLoad}
      >
        <NavigationControl position="top-right" />
        {markers}
        {popup && popup.lat != null && popup.lon != null && (
          <Popup
            longitude={popup.lon}
            latitude={popup.lat}
            onClose={() => { setPopup(null); onFocusChange?.(null); }}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={20}
            className="cg-popup"
          >
            {(() => {
              const loadPct =
                popup.total_installed_power_kw != null &&
                popup.total_installed_power_kw > 0 &&
                popup.total_load_kw != null
                  ? Math.round((popup.total_load_kw / popup.total_installed_power_kw) * 100)
                  : null;
              const isOnline = popup.status === "ONLINE";
              return (
                <div
                  className="cursor-pointer select-none"
                  onClick={() => onDive ? onDive(popup.router_sn) : navigate(`/objects/${popup.router_sn}`)}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm leading-tight truncate">
                        {popup.name || popup.router_sn}
                      </p>
                      {popup.name && (
                        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                          {popup.router_sn}
                        </p>
                      )}
                    </div>
                    <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      isOnline
                        ? "bg-green-500/15 text-green-400"
                        : "bg-zinc-500/15 text-zinc-500"
                    }`}>
                      {isOnline ? "онлайн" : "офлайн"}
                    </span>
                    <button
                      className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={(e) => { e.stopPropagation(); setPopup(null); onFocusChange?.(null); }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>

                  {/* Power stats — показываем вместе с разделителем только если есть данные */}
                  {popup.total_installed_power_kw != null ? (
                  <><div className="h-px bg-border mb-2" />
                    <div className="mb-2">
                      {/* Строка: лейбл слева, процент справа */}
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-[11px] text-muted-foreground">Нагрузка</span>
                        {loadPct != null && (
                          <span className={`text-[11px] font-semibold tabular-nums ${
                            loadPct > 85 ? "text-red-400" :
                            loadPct > 65 ? "text-amber-400" :
                            "text-foreground"
                          }`}>{loadPct}%</span>
                        )}
                      </div>
                      {/* Прогресс-бар */}
                      {loadPct != null && (
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-1.5">
                          <div
                            className={`h-full rounded-full transition-all ${
                              loadPct > 85 ? "bg-red-500" :
                              loadPct > 65 ? "bg-amber-400" :
                              "bg-blue-500"
                            }`}
                            style={{ width: `${Math.min(loadPct, 100)}%` }}
                          />
                        </div>
                      )}
                      {/* Значения кВт под баром */}
                      <div className="text-right tabular-nums">
                        <span className="text-[11px] font-medium">
                          {popup.total_load_kw != null ? popup.total_load_kw.toFixed(0) : "—"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {" / "}{Math.round(popup.total_installed_power_kw)} кВт
                        </span>
                      </div>
                    </div>
                  </>) : null}

                  {/* Footer */}
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-[11px] text-muted-foreground">
                      {popup.equipment_count} {popup.equipment_count === 1 ? "установка" : "установки"}
                    </span>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      Открыть
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 5h6M5 2l3 3-3 3"/>
                      </svg>
                    </span>
                  </div>
                </div>
              );
            })()}
          </Popup>
        )}
      </Map>

      {/* Эффект "ныряния" — затемнение с "туннельным" сужением */}
      {isDiving && (
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: "radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.95) 70%)",
            animation: "dive-fade 0.8s ease-in forwards",
          }}
        />
      )}
      <style>{`
        @keyframes dive-fade {
          0%   { opacity: 0; }
          5%   { opacity: 0.5; }
          20%  { opacity: 0.85; }
          45%  { opacity: 1; }
          100% { opacity: 1; }
        }
        .cg-popup .maplibregl-popup-content {
          background: var(--background) !important;
          color: var(--foreground) !important;
          border: 1px solid var(--border) !important;
          border-radius: 10px !important;
          padding: 12px 14px !important;
          width: 240px !important;
          box-sizing: content-box !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.25) !important;
          font-family: inherit !important;
          overflow: hidden !important;
        }
        .cg-popup .maplibregl-popup-tip {
          border-top-color: var(--background) !important;
          filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3));
        }
      `}</style>

      {/* Переключатель провайдера карт */}
      <div className="absolute bottom-2 left-2 flex gap-1 bg-background/80 backdrop-blur-sm rounded-md border p-1 text-[10px]">
        {(Object.keys(MAP_STYLES) as MapProvider[]).map((p) => (
          <button
            key={p}
            onClick={() => handleProviderChange(p)}
            className={`px-2 py-0.5 rounded transition-colors ${
              provider === p
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {MAP_PROVIDER_LABELS[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
