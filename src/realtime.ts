export interface RealtimeMarketEvent {
  event: string;
  contract?: string;
  receivedAt: number;
}

export interface ReservoirRealtimeOptions {
  apiKey: string;
  contracts: string[];
  onMarketEvent: (event: RealtimeMarketEvent) => void;
  onStatus?: (status: string, detail?: string) => void;
}

type ReservoirMessage = {
  event?: unknown;
  status?: unknown;
  tags?: { contract?: unknown };
};

const MARKET_EVENTS = ["ask.created", "ask.updated", "bid.created", "bid.updated", "sale.created"] as const;

export class ReservoirRealtimeWatcher {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ReservoirRealtimeOptions) {}

  start(): void {
    if (this.options.contracts.length === 0) throw new Error("Realtime watcher requires at least one contract");
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, "shutdown");
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const url = `wss://ws.reservoir.tools?api_key=${encodeURIComponent(this.options.apiKey)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    this.options.onStatus?.("connecting");

    socket.addEventListener("open", () => this.options.onStatus?.("connected"));
    socket.addEventListener("message", (event) => { void this.handleMessage(event); });
    socket.addEventListener("error", () => this.options.onStatus?.("error"));
    socket.addEventListener("close", (event) => {
      this.options.onStatus?.("closed", `${event.code}:${event.reason}`);
      this.socket = null;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const text = await this.messageText(event.data);
    if (!text) return;

    let message: ReservoirMessage;
    try {
      message = JSON.parse(text) as ReservoirMessage;
    } catch {
      return;
    }

    if (message.status === "ready") {
      this.reconnectAttempt = 0;
      for (const marketEvent of MARKET_EVENTS) {
        this.socket?.send(JSON.stringify({
          type: "subscribe",
          event: marketEvent,
          filters: { contract: this.options.contracts },
        }));
      }
      this.options.onStatus?.("subscribed", `${MARKET_EVENTS.length} event classes`);
      return;
    }

    if (typeof message.event !== "string" || !(MARKET_EVENTS as readonly string[]).includes(message.event)) return;
    const contract = typeof message.tags?.contract === "string" ? message.tags.contract.toLowerCase() : undefined;
    this.options.onMarketEvent({ event: message.event, contract, receivedAt: Date.now() });
  }

  private async messageText(data: unknown): Promise<string | null> {
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
    if (typeof Blob !== "undefined" && data instanceof Blob) return await data.text();
    return null;
  }

  private scheduleReconnect(): void {
    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    const baseMs = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
    const jitterMs = Math.floor(Math.random() * 500);
    this.options.onStatus?.("reconnecting", `${baseMs + jitterMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, baseMs + jitterMs);
  }
}
