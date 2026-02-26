import { create } from "zustand";
import type { WsMessage, TelemetryItem } from "@/lib/ws";

export interface RegisterValue {
  addr: number;
  name: string;
  value: number | null;
  text: string | null;
  unit: string | null;
  raw: number | null;
  reason: string | null;
  ts: string | null;
  /** Время получения данных браузером (ISO) */
  receivedAt: string;
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
  /** Drift (сек) между часами сервера и браузера, per router_sn */
  drifts: Map<string, number>;
  connected: boolean;

  handleMessage: (msg: WsMessage) => void;
  _applyTelemetryItem: (msg: TelemetryItem) => void;
  setConnected: (c: boolean) => void;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  registers: new Map(),
  statuses: new Map(),
  lastUpdate: new Map(),
  drifts: new Map(),
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
      const ts = msg.timestamp || new Date().toISOString();
      const receivedAt = new Date().toISOString();
      const current = get().registers;
      const regMap = new Map(current.get(key) || []);
      for (const r of msg.registers) {
        regMap.set(r.addr, { ...r, ts: r.ts ?? ts, receivedAt });
      }
      const newRegs = new Map(current);
      newRegs.set(key, regMap);

      const newUpdate = new Map(get().lastUpdate);
      newUpdate.set(key, Date.now());

      // Данные пришли — оборудование на связи
      const newStatuses = new Map(get().statuses);
      newStatuses.set(key, "ONLINE");

      // Drift: разница часов сервера и браузера (по router_sn)
      const serverTime = msg.timestamp ? new Date(msg.timestamp).getTime() : null;
      const browserTime = Date.now();
      const driftSec = serverTime ? Math.round((browserTime - serverTime) / 1000) : null;
      const newDrifts = new Map(get().drifts);
      if (driftSec !== null) {
        newDrifts.set(msg.router_sn, driftSec);
      }

      if (import.meta.env.DEV) {
        console.debug(
          `[telemetry] ${key}: ${msg.registers.length} regs | server: ${msg.timestamp} | drift: ${driftSec !== null ? driftSec + "s" : "n/a"}`,
        );
      }

      set({ registers: newRegs, lastUpdate: newUpdate, statuses: newStatuses, drifts: newDrifts });
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
