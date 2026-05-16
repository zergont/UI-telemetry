import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Map, {
  Marker,
  NavigationControl,
  Popup,
} from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import "./objects-map.css";
import type { ObjectOut } from "@/hooks/use-objects";
import { useTheme } from "@/hooks/use-theme";
import DguMarker from "./DguMarker";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type MapProvider,
  MAP_STYLES,
  getMapProvider,
  setMapProvider,
} from "./map-provider";
import ObjectsMapPopup from "./ObjectsMapPopup";
import MapProviderSwitcher from "./MapProviderSwitcher";
import DiveOverlay from "./DiveOverlay";

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
  const [isDiving, setIsDiving] = useState(false);

  const closePopup = useCallback(() => {
    setPopup(null);
    onFocusChange?.(null);
  }, [onFocusChange]);

  const navigateToObject = useCallback(
    (routerSn: string) => {
      navigate(`/objects/${routerSn}`);
    },
    [navigate],
  );

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
  const mapStyle = (theme === "dark" ? styles.dark : styles.light) as string | object;

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
    const frame = requestAnimationFrame(() => setPopup(obj));
    return () => cancelAnimationFrame(frame);
  }, [focusedSn, geoObjects]);

  // "Ныряние" в объект — zoom до максимума, потом навигация
  useEffect(() => {
    if (!divingSn || !mapLoadedRef.current) return;
    const map = mapRef.current;
    if (!map) return;

    const obj = geoObjects.find((o) => o.router_sn === divingSn);
    if (!obj || obj.lat == null || obj.lon == null) {
      navigateToObject(divingSn);
      return;
    }

    const frame = requestAnimationFrame(() => {
      setIsDiving(true);
      setPopup(null);
    });

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
      navigateToObject(divingSn);
    }, NAV_AT);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [divingSn, geoObjects, navigateToObject]);

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
            onClose={closePopup}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={20}
            className="cg-popup"
          >
            <ObjectsMapPopup
              object={popup}
              onDive={onDive}
              onNavigate={navigateToObject}
              onClose={closePopup}
            />
          </Popup>
        )}
      </Map>

      {isDiving && <DiveOverlay />}

      <MapProviderSwitcher provider={provider} onChange={handleProviderChange} />
    </div>
  );
}
