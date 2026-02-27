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

// --- CartoDB vector tile styles for MapLibre ---
const CARTO_STYLES: Record<string, string> = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

interface Props {
  objects: ObjectOut[];
  isLoading: boolean;
}

export default function ObjectsMap({ objects, isLoading }: Props) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const mapRef = useRef<MapRef>(null);
  const [popup, setPopup] = useState<ObjectOut | null>(null);
  const fittedRef = useRef(false);
  const mapLoadedRef = useRef(false);

  const handleMarkerClick = useCallback(
    (obj: ObjectOut) => setPopup(obj),
    [],
  );

  const mapStyle = theme === "dark" ? CARTO_STYLES.dark : CARTO_STYLES.light;

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
        zoom: 12,
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
      { padding: 80, maxZoom: 14, duration: 800 },
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

  if (isLoading) {
    return <Skeleton className="h-full w-full rounded-xl" />;
  }

  return (
    <Map
      ref={mapRef}
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
          onClose={() => setPopup(null)}
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
  );
}
