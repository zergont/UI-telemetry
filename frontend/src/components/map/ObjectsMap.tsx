import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Map, {
  Marker,
  NavigationControl,
  Popup,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ObjectOut } from "@/hooks/use-objects";
import DguMarker from "./DguMarker";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  objects: ObjectOut[];
  isLoading: boolean;
}

export default function ObjectsMap({ objects, isLoading }: Props) {
  const navigate = useNavigate();
  const [popup, setPopup] = useState<ObjectOut | null>(null);

  const handleMarkerClick = useCallback(
    (obj: ObjectOut) => setPopup(obj),
    [],
  );

  const markers = useMemo(
    () =>
      objects
        .filter((o) => o.lat != null && o.lon != null)
        .map((obj) => (
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
    [objects, handleMarkerClick],
  );

  if (isLoading) {
    return <Skeleton className="h-full w-full rounded-xl" />;
  }

  return (
    <Map
      initialViewState={{
        longitude: 100,
        latitude: 62,
        zoom: 3,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle="https://demotiles.maplibre.org/style.json"
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
