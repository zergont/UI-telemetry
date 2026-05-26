import { create } from "zustand";
import type { WsMessage, TelemetryItem } from "@/lib/ws";

/** Live register snapshot from WebSocket — raw values only.
 *  Metadata (name, text, unit, faults) comes from the HTTP /api/registers response.
 */
export interface RegisterValue {
  addr: number;
  value: number | null;
  raw: number | null;
  ts: string | null;
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
        regMap.set(r.addr, {
          addr: r.addr,
          value: r.value,
          raw: r.raw,
          ts: r.ts ?? ts,
          receivedAt,
        });
      }

      const newRegs = new Map(current);
      newRegs.set(key, regMap);

      const newUpdate = new Map(get().lastUpdate);
      newUpdate.set(key, Date.now());

      const newStatuses = new Map(get().statuses);
      newStatuses.set(key, "ONLINE");

      const serverTime = msg.timestamp ? new Date(msg.timestamp).getTime() : null;
      const driftSec = serverTime ? Math.round((Date.now() - serverTime) / 1000) : null;
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
