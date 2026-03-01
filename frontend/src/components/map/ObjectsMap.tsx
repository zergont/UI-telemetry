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
}

export default function ObjectsMap({
  objects,
  isLoading,
  focusedSn,
  onFocusChange,
  divingSn,
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
      setPopup(obj);
      onFocusChange?.(obj.router_sn);
    },
    [onFocusChange],
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
        zoom: 5,
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
      { padding: 80, maxZoom: 5, duration: 800 },
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
      zoom: 14,
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
    map.flyTo({
      center: [obj.lon, obj.lat],
      zoom: 22,
      duration: 3000,
      essential: true,
    });

    // После анимации зума + небольшая пауза на затемнение — переходим
    const onEnd = () => {
      setTimeout(() => {
        navigate(`/objects/${divingSn}`);
      }, 400);
    };
    map.once("moveend", onEnd);

    return () => {
      map.off("moveend", onEnd);
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
            closeButton={true}
            closeOnClick={false}
            anchor="bottom"
            offset={16}
          >
            <div
              className="cursor-pointer px-1 py-0.5"
              onClick={() => navigate(`/objects/${popup.router_sn}`)}
            >
              <p className="font-semibold text-sm text-gray-900">
                {popup.name || popup.router_sn}
              </p>
              <p className="text-xs text-gray-500">
                Оборудование: {popup.equipment_count}
              </p>
            </div>
          </Popup>
        )}
      </Map>

      {/* Эффект "ныряния" — затемнение с "туннельным" сужением */}
      {isDiving && (
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: "radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.95) 70%)",
            animation: "dive-fade 3s ease-in forwards",
          }}
        />
      )}
      <style>{`
        @keyframes dive-fade {
          0%   { opacity: 0; }
          20%  { opacity: 0.3; }
          60%  { opacity: 0.7; }
          85%  { opacity: 1; }
          100% { opacity: 1; }
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
