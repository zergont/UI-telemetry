export type WsMessage = {
  type: "telemetry" | "status_change";
  router_sn: string;
  equip_type?: string;
  panel_id?: number;
  timestamp?: string;
  registers?: Array<{
    addr: number;
    name: string;
    value: number | null;
    text: string | null;
    unit: string | null;
    raw: number | null;
    reason: string | null;
  }>;
  status?: string;
};

type WsOptions = {
  url: string;
  token: string;
  subscribe?: string;
  onMessage: (msg: WsMessage) => void;
  onStatusChange?: (connected: boolean) => void;
};

export function createWebSocket(options: WsOptions) {
  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  let shouldReconnect = true;
  let reconnectTimer: ReturnType<typeof setTimeout>;

  function connect() {
    const params = new URLSearchParams({ token: options.token });
    if (options.subscribe) params.set("subscribe", options.subscribe);

    const url = `${options.url}?${params}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectDelay = 1000;
      options.onStatusChange?.(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        options.onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      options.onStatusChange?.(false);
      if (shouldReconnect) {
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      }
    };

    ws.onerror = () => ws?.close();
  }

  connect();

  return {
    close() {
      shouldReconnect = false;
      clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
