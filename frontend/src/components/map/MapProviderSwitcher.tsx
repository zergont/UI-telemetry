/**
 * Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
 * Программный комплекс «Честная Генерация»
 * Модуль веб-дашборда и визуализации телеметрии
 * Автор: Саввиди Александр Анатольевич | ИНН 4725009270
 *
 * Данное программное обеспечение является конфиденциальным.
 * Несанкционированное копирование, распространение или использование
 * без письменного разрешения правообладателя запрещено.
 */

import { useState } from "react";
import { Layers } from "lucide-react";
import { MAP_PROVIDER_LABELS, MAP_STYLES, type MapProvider } from "./map-provider";

interface MapProviderSwitcherProps {
  provider: MapProvider;
  onChange: (provider: MapProvider) => void;
}

export default function MapProviderSwitcher({
  provider,
  onChange,
}: MapProviderSwitcherProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute bottom-2 left-2">
      {open ? (
        <div className="flex gap-1 rounded-md border bg-background/80 p-1 text-[10px] backdrop-blur-sm">
          {(Object.keys(MAP_STYLES) as MapProvider[]).map((nextProvider) => (
            <button
              key={nextProvider}
              onClick={() => {
                onChange(nextProvider);
                setOpen(false);
              }}
              className={`rounded px-2 py-0.5 transition-colors ${
                provider === nextProvider
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {MAP_PROVIDER_LABELS[nextProvider]}
            </button>
          ))}
          <button
            onClick={() => setOpen(false)}
            className="rounded px-1 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 rounded-md border bg-background/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm hover:text-foreground transition-colors"
        >
          <Layers className="h-3 w-3" />
          {MAP_PROVIDER_LABELS[provider]}
        </button>
      )}
    </div>
  );
}
