export type MapProvider = "carto" | "maptiler" | "openfreemap";

const MAPTILER_KEY = "7rleXA0jqiQBKMYrXAs3";

export const MAP_STYLES: Record<MapProvider, Record<string, string>> = {
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
