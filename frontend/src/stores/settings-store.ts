import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TzOption {
  offset: number; // часы от UTC
  label: string;
}

export const TZ_OPTIONS: TzOption[] = [
  { offset: 2,  label: "UTC+2 — Калининград" },
  { offset: 3,  label: "UTC+3 — Москва, Санкт-Петербург" },
  { offset: 4,  label: "UTC+4 — Самара, Ижевск" },
  { offset: 5,  label: "UTC+5 — Екатеринбург" },
  { offset: 6,  label: "UTC+6 — Омск" },
  { offset: 7,  label: "UTC+7 — Красноярск, Новосибирск" },
  { offset: 8,  label: "UTC+8 — Иркутск" },
  { offset: 9,  label: "UTC+9 — Якутск" },
  { offset: 10, label: "UTC+10 — Владивосток, Хабаровск" },
  { offset: 11, label: "UTC+11 — Магадан, Сахалин" },
  { offset: 12, label: "UTC+12 — Камчатка, Чукотка" },
];

interface SettingsState {
  tzOffsetHours: number;
  setTzOffsetHours: (v: number) => void;
  /** Минимум пропущенных точек подряд, чтобы считать разрывом (красная зона) */
  minGapPoints: number;
  setMinGapPoints: (v: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      tzOffsetHours: 3,
      setTzOffsetHours: (v) => set({ tzOffsetHours: v }),
      minGapPoints: 3,
      setMinGapPoints: (v) => set({ minGapPoints: v }),
    }),
    { name: "app-settings" },
  ),
);
