/**
 * Transport abstraction for the Clawline channel.
 *
 * Two implementations:
 *  - BrowserTransport (browser/PWA)  — WebSocket directly in JS, owns heartbeat
 *    and reconnect.
 *  - TauriTransport (desktop)        — invokes Rust commands; reconnect &
 *    heartbeat live in the Rust process and survive webview close.
 *
 * The selector lives in clawChannel.ts. Public ChannelManager API stays the
 * same; transports are an internal detail.
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface InboundPacket {
  type: string;
  data: Record<string, unknown> & {
    chatId?: string;
    senderId?: string;
    agentId?: string;
    timestamp?: number;
  };
}

export interface ConnectOptions {
  connectionId: string;
  serverUrl: string;
  chatId?: string;
  channelId?: string;
  agentId?: string;
  senderId: string;
  senderName?: string;
  token?: string;
}

export interface ReconnectInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

export interface OutboundPacket {
  type: string;
  data: Record<string, unknown>;
}

export interface IChannelTransport {
  /** Open (or replace) a connection. Idempotent. */
  connect(opts: ConnectOptions): void | Promise<void>;
  /** Close a single connection. `manual=true` skips reconnect. */
  close(connectionId: string, manual: boolean): void | Promise<void>;
  /** Force an immediate reconnect attempt. */
  reconnect(connectionId: string): void | Promise<void>;

  /** Enqueue an outbound packet. The transport handles offline buffering. */
  send(connectionId: string, packet: OutboundPacket): void | Promise<void>;
  isReady(connectionId: string): boolean;

  getStatus(connectionId: string): ConnectionStatus;
  getReconnectInfo(connectionId: string): ReconnectInfo;

  /** Subscribe to inbound packets — returns an unsubscribe function. */
  onPacket(connectionId: string, fn: (p: InboundPacket) => void): () => void;
  /** Subscribe to status changes — returns unsubscribe. */
  onStatus(connectionId: string, fn: (s: ConnectionStatus) => void): () => void;
  /** Subscribe to errors. */
  onError(fn: (connectionId: string, err: { code: string; message: string }) => void): () => void;

  /** Cleanup all connections and listeners. */
  destroy(): void;
}
