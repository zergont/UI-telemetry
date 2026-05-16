import type { StyleSpecification } from "maplibre-gl";

export type MapProvider = "carto" | "maptiler" | "openfreemap" | "osm";

const MAPTILER_KEY = "7rleXA0jqiQBKMYrXAs3";

const osmRasterStyle = (dark: boolean): StyleSpecification => ({
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["/api/tiles/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm-tiles",
      type: "raster",
      source: "osm",
      paint: dark
        ? { "raster-hue-rotate": 180, "raster-brightness-min": 0.08, "raster-brightness-max": 0.35, "raster-saturation": -0.6 }
        : {},
    },
  ],
});

export const MAP_STYLES: Record<MapProvider, Record<string, string | StyleSpecification>> = {
  carto: {
    dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  },
  maptiler: {
    dark: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`,
    light: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
  },
  openfreemap: {
    dark: "https://tiles.openfreemap.org/styles/dark",
    light: "https://tiles.openfreemap.org/styles/liberty",
  },
  osm: {
    dark: osmRasterStyle(true),
    light: osmRasterStyle(false),
  },
};

export const MAP_PROVIDER_LABELS: Record<MapProvider, string> = {
  carto: "CartoDB",
  maptiler: "MapTiler",
  openfreemap: "OpenFreeMap",
  osm: "OpenStreetMap",
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
