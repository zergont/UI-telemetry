import { MAP_PROVIDER_LABELS, MAP_STYLES, type MapProvider } from "./map-provider";

interface MapProviderSwitcherProps {
  provider: MapProvider;
  onChange: (provider: MapProvider) => void;
}

export default function MapProviderSwitcher({
  provider,
  onChange,
}: MapProviderSwitcherProps) {
  return (
    <div className="absolute bottom-2 left-2 flex gap-1 rounded-md border bg-background/80 p-1 text-[10px] backdrop-blur-sm">
      {(Object.keys(MAP_STYLES) as MapProvider[]).map((nextProvider) => (
        <button
          key={nextProvider}
          onClick={() => onChange(nextProvider)}
          className={`rounded px-2 py-0.5 transition-colors ${
            provider === nextProvider
              ? "bg-primary font-medium text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {MAP_PROVIDER_LABELS[nextProvider]}
        </button>
      ))}
    </div>
  );
}
