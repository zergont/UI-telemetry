import { create } from "zustand";
import type { WsMessage, TelemetryItem } from "@/lib/ws";

interface RegisterValue {
  addr: number;
  name: string;
  value: number | null;
  text: string | null;
  unit: string | null;
  raw: number | null;
  reason: string | null;
}

export function makeEquipKey(
  routerSn: string,
  equipType: string,
  panelId: number | string,
): string {
  return `${routerSn}:${equipType}:${panelId}`;
}

interface TelemetryState {
  registers: Map<string, Map<number, RegisterValue>>;
  statuses: Map<string, string>;
  lastUpdate: Map<string, number>;
  connected: boolean;

  handleMessage: (msg: WsMessage) => void;
  _applyTelemetryItem: (msg: TelemetryItem) => void;
  setConnected: (c: boolean) => void;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  registers: new Map(),
  statuses: new Map(),
  lastUpdate: new Map(),
  connected: false,

  handleMessage(msg: WsMessage) {
    // Snapshot — массив закэшированных сообщений при подключении
    if (msg.type === "snapshot" && "items" in msg) {
      for (const item of msg.items) {
        get()._applyTelemetryItem(item);
      }
      return;
    }

    get()._applyTelemetryItem(msg as TelemetryItem);
  },

  _applyTelemetryItem(msg: TelemetryItem) {
    if (msg.type === "telemetry" && msg.registers) {
      const key = makeEquipKey(
        msg.router_sn,
        msg.equip_type || "pcc",
        msg.panel_id ?? 0,
      );
      const current = get().registers;
      const regMap = new Map(current.get(key) || []);
      for (const r of msg.registers) {
        regMap.set(r.addr, r);
      }
      const newRegs = new Map(current);
      newRegs.set(key, regMap);

      const newUpdate = new Map(get().lastUpdate);
      newUpdate.set(key, Date.now());

      set({ registers: newRegs, lastUpdate: newUpdate });
    } else if (msg.type === "status_change" && msg.status) {
      const key = makeEquipKey(
        msg.router_sn,
        msg.equip_type || "",
        msg.panel_id ?? 0,
      );
      const newStatuses = new Map(get().statuses);
      newStatuses.set(key, msg.status);
      set({ statuses: newStatuses });
    }
  },

  setConnected(c: boolean) {
    set({ connected: c });
  },
}));
