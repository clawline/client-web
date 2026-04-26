/**
 * Tauri transport — delegates WS lifecycle to the Rust process.
 *
 * - `connect` invokes `ws_connect`; the Rust actor handles dial, heartbeat,
 *   reconnect, and offline buffering.
 * - `send` invokes `ws_send`; if the socket is down, Rust appends to SQLite
 *   and replays on reconnect.
 * - Inbound packets, status changes and errors arrive as Tauri events on
 *   per-connection topics (`ws://packet/<id>`, `ws://status/<id>`, `ws://error/<id>`).
 */

import type {
  ConnectionStatus,
  ConnectOptions,
  IChannelTransport,
  InboundPacket,
  OutboundPacket,
  ReconnectInfo,
} from './IChannelTransport';

interface TauriInternals {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

type Unlisten = () => void;

interface ConnState {
  url: string;
  status: ConnectionStatus;
  reconnect: ReconnectInfo;
  packetListeners: Set<(p: InboundPacket) => void>;
  statusListeners: Set<(s: ConnectionStatus) => void>;
  unlisten: Unlisten[];
  /** Last connect-options snapshot — used by reconnect() to re-dial with full args. */
  lastConnect?: ConnectOptions;
}

export class TauriTransport implements IChannelTransport {
  private internals: TauriInternals;
  private states = new Map<string, ConnState>();
  private errorListeners = new Set<(connectionId: string, err: { code: string; message: string }) => void>();

  constructor() {
    const win = window as unknown as { __TAURI_INTERNALS__: TauriInternals };
    this.internals = win.__TAURI_INTERNALS__;
  }

  /** Get-or-create per-connection state. Listeners may be attached BEFORE
   *  connect() runs — we need to remember them, otherwise the events Rust
   *  emits (which can fire before connect resolves) get dropped. */
  private getOrCreateState(connectionId: string): ConnState {
    let state = this.states.get(connectionId);
    if (!state) {
      state = {
        url: '',
        status: 'disconnected',
        reconnect: { attempt: 0, maxAttempts: 6, delayMs: 0 },
        packetListeners: new Set(),
        statusListeners: new Set(),
        unlisten: [],
      };
      this.states.set(connectionId, state);
    }
    return state;
  }

  private async listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<T>(event, (e) => handler(e.payload));
    return unlisten;
  }

  async connect(opts: ConnectOptions): Promise<void> {
    // Get-or-create — preserves any listeners already registered.
    const state = this.getOrCreateState(opts.connectionId);
    state.url = opts.serverUrl;
    state.lastConnect = opts;

    // Tear down any prior Tauri event subscriptions, but KEEP the listener Sets.
    for (const u of state.unlisten) {
      try { u(); } catch { /* ignore */ }
    }
    state.unlisten = [];

    // CRITICAL: subscribe before invoking ws_connect, otherwise the first
    // status events emitted by the Rust actor get lost.
    state.unlisten.push(
      await this.listen<{ packet: InboundPacket }>(
        `ws://packet/${opts.connectionId}`,
        (payload) => {
          for (const fn of state.packetListeners) fn(payload.packet);
        },
      ),
    );
    state.unlisten.push(
      await this.listen<{
        status: ConnectionStatus;
        reconnectAttempt?: number;
        maxAttempts?: number;
        delayMs?: number;
      }>(`ws://status/${opts.connectionId}`, (payload) => {
        state.status = payload.status;
        state.reconnect = {
          attempt: payload.reconnectAttempt ?? 0,
          maxAttempts: payload.maxAttempts ?? 6,
          delayMs: payload.delayMs ?? 0,
        };
        for (const fn of state.statusListeners) fn(payload.status);
      }),
    );
    state.unlisten.push(
      await this.listen<{ code: string; message: string }>(
        `ws://error/${opts.connectionId}`,
        (payload) => {
          for (const fn of this.errorListeners) fn(opts.connectionId, payload);
        },
      ),
    );

    // Use camelCase keys — Tauri 2 derives JS arg names from snake_case Rust params.
    await this.internals.invoke('ws_connect', { opts });
  }

  async close(connectionId: string, manual: boolean): Promise<void> {
    const state = this.states.get(connectionId);
    if (state) {
      // Detach Tauri event subscriptions; keep listener Sets so reconnects
      // re-route events to the same React subscribers.
      for (const u of state.unlisten) {
        try { u(); } catch { /* ignore */ }
      }
      state.unlisten = [];
      state.status = 'disconnected';
    }
    try {
      await this.internals.invoke('ws_disconnect', { connId: connectionId, manual });
    } catch (err) {
      console.warn('[ws] disconnect failed', err);
    }
  }

  async reconnect(connectionId: string): Promise<void> {
    const state = this.states.get(connectionId);
    if (!state?.lastConnect) return;
    await this.connect(state.lastConnect);
  }

  async send(connectionId: string, packet: OutboundPacket): Promise<void> {
    await this.internals.invoke('ws_send', {
      connId: connectionId,
      packet,
    });
  }

  isReady(connectionId: string): boolean {
    return this.states.get(connectionId)?.status === 'connected';
  }

  getStatus(connectionId: string): ConnectionStatus {
    return this.states.get(connectionId)?.status ?? 'disconnected';
  }

  getReconnectInfo(connectionId: string): ReconnectInfo {
    return this.states.get(connectionId)?.reconnect ?? { attempt: 0, maxAttempts: 6, delayMs: 0 };
  }

  onPacket(connectionId: string, fn: (p: InboundPacket) => void): () => void {
    // Lazily ensure state — listeners may attach BEFORE connect() runs.
    const state = this.getOrCreateState(connectionId);
    state.packetListeners.add(fn);
    return () => state.packetListeners.delete(fn);
  }

  onStatus(connectionId: string, fn: (s: ConnectionStatus) => void): () => void {
    const state = this.getOrCreateState(connectionId);
    state.statusListeners.add(fn);
    return () => state.statusListeners.delete(fn);
  }

  onError(fn: (connectionId: string, err: { code: string; message: string }) => void): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  destroy(): void {
    for (const [id, state] of this.states) {
      for (const u of state.unlisten) {
        try { u(); } catch { /* ignore */ }
      }
      void this.close(id, true);
    }
    this.states.clear();
    this.errorListeners.clear();
  }
}
