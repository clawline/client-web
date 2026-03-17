import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* ── data helpers ── */

export const ANIMALS: [string, string][] = [
  ["🐻","bear"],["🦊","fox"],["🐺","wolf"],["🦅","eagle"],["🐬","dolphin"],
  ["🦁","lion"],["🐯","tiger"],["🦌","deer"],["🐳","whale"],["🦉","owl"],
  ["🐧","penguin"],["🦈","shark"],["🐆","leopard"],["🦜","parrot"],["🐨","koala"],
  ["🦇","bat"],["🐙","octopus"],["🦎","lizard"],["🐢","turtle"],["🦩","flamingo"],
  ["🐝","bee"],["🦋","butterfly"],["🐘","elephant"],["🦔","hedgehog"],["🐊","croc"],
];

export function pickAnimal(): [string, string] {
  return ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
}

export function animalIcon(id: string): string {
  if (!id) return "🖥️";
  const found = ANIMALS.find(([, n]) => id.includes(n));
  if (found) return found[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return ANIMALS[Math.abs(h) % ANIMALS.length][0];
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 6e4) return "刚刚";
  if (d < 36e5) return `${Math.floor(d / 6e4)}分前`;
  if (d < 864e5) return `${Math.floor(d / 36e5)}时前`;
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function randomToken(): string {
  if (globalThis.crypto?.randomUUID)
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  if (globalThis.crypto?.getRandomValues) {
    const b = new Uint8Array(16);
    globalThis.crypto.getRandomValues(b);
    return Array.from(b, v => v.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    .replace(/\./g, "").slice(0, 32);
}

/* ── types ── */

export interface ServerState { publicBaseUrl?: string; channels?: ChannelInfo[]; adminAuthEnabled?: boolean }
export interface ChannelInfo {
  channelId: string; label?: string; secret?: string; tokenParam?: string;
  backendConnected?: boolean; instanceId?: string; userCount?: number; clientCount?: number;
  users?: UserInfo[];
}
export interface UserInfo {
  id?: string; senderId: string; chatId?: string; token: string;
  allowAgents?: string[]; enabled?: boolean;
}

/* ── URL builders ── */

function httpOrigin(v?: string): string {
  if (!v) return location.origin;
  try { return new URL(v).origin; } catch { return location.origin; }
}

function wsOrigin(o: string): string {
  const u = new URL(o);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.origin;
}

export function clientUrl(state: ServerState | null, channel: ChannelInfo | null): string {
  return `${wsOrigin(httpOrigin(state?.publicBaseUrl))}/client?channelId=${encodeURIComponent(channel?.channelId || "")}`;
}

export function clientFullUrl(state: ServerState | null, channel: ChannelInfo | null, user: UserInfo): string {
  return `${clientUrl(state, channel)}&${encodeURIComponent(channel?.tokenParam || "token")}=${encodeURIComponent(user.token || "")}`;
}

export function backendUrl(state: ServerState | null): string {
  return `${wsOrigin(httpOrigin(state?.publicBaseUrl))}/backend`;
}

export function instanceId(channel: ChannelInfo | null): string {
  return `openclaw-${(channel?.channelId || "node").replace(/[^a-z0-9-]/gi, "-").slice(0, 32)}`;
}

export function pluginYaml(state: ServerState | null, channel: ChannelInfo | null): string {
  return `channels:\n  clawline:\n    enabled: true\n    connectionMode: "relay"\n    relay:\n      url: "${backendUrl(state)}"\n      channelId: "${channel?.channelId || ""}"\n      secret: "${channel?.secret || ""}"\n      instanceId: "${instanceId(channel)}"\n    auth:\n      enabled: false`;
}

export function connectionUrl(state: ServerState | null, channel: ChannelInfo | null, user: UserInfo): string {
  const p = new URLSearchParams();
  p.set("serverUrl", clientUrl(state, channel));
  p.set("token", user.token || "");
  p.set("name", user.senderId || "");
  p.set("senderId", user.senderId || "");
  if (user.chatId) p.set("chatId", user.chatId);
  const ag = Array.isArray(user.allowAgents) ? user.allowAgents.filter(a => a && a !== "*") : [];
  if (ag[0]) p.set("agentId", ag[0]);
  return `openclaw://connect?${p.toString()}`;
}

/* ── API ── */

export async function api<T = unknown>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const hd = new Headers(init.headers as HeadersInit);
  if (init.body && !hd.has("content-type")) hd.set("content-type", "application/json");
  if (token) hd.set("x-relay-admin-token", token);
  const r = await fetch(path, { ...init, headers: hd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error || `HTTP ${r.status}`);
  return d as T;
}

/* ── Clipboard ── */

export async function copyText(v: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(v);
  const t = document.createElement("textarea");
  t.value = v;
  t.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(t);
  t.select();
  document.execCommand("copy");
  t.remove();
}

export const SK = "relay-admin-token";
