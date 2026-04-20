import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react';
import { Search, Server, Loader2, RefreshCw, Plus, ChevronDown, LayoutGrid, List, ArrowUpDown, Check, Crown, GripVertical, Star, Pencil } from 'lucide-react';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';
import { CONNECTIONS_UPDATED_EVENT, getConnections, getConnectionById, setActiveConnectionId, type ServerConnection } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import type { AgentInfo, ConversationSummary, ChannelStatus } from '../services/clawChannel';
import { getUserId } from '../App';
import AvatarUploader from '../components/AvatarUploader';
import { stripMarkdownForPreview } from '../components/chat/utils';

const PREVIEW_KEY_PREFIX = 'clawline.agentPreview.';
const EXPANDED_KEY = 'clawline.chatlist.expandedIds';
const VIEW_MODE_KEY = 'clawline.chatlist.viewMode';
const AGENT_ORDER_KEY_PREFIX = 'clawline.agentOrder.';
const LEGACY_AGENT_ORDER_KEY = 'clawline.chatlist.agentOrder';
const AGENT_AVATAR_KEY = 'clawline.agentAvatars';
const AGENT_NAMES_KEY = 'clawline.agentNames';
const AGENT_FAVORITES_KEY = 'clawline.agentFavorites';
const MESSAGE_PREVIEW_UPDATED_EVENT = 'openclaw:message-preview-updated';

type ViewMode = 'list' | 'grid';
type PendingOpen = { agentId: string; target: 'primary' | 'split' };

// ── Helpers ──────────────────────────────────────────────────────────

function getCustomAvatars(): Record<string, string> {
  try { const raw = localStorage.getItem(AGENT_AVATAR_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function setCustomAvatar(connId: string, agentId: string, url: string) {
  const avatars = getCustomAvatars(); avatars[`${connId}:${agentId}`] = url;
  localStorage.setItem(AGENT_AVATAR_KEY, JSON.stringify(avatars));
}
function removeCustomAvatar(connId: string, agentId: string) {
  const avatars = getCustomAvatars(); delete avatars[`${connId}:${agentId}`];
  localStorage.setItem(AGENT_AVATAR_KEY, JSON.stringify(avatars));
}
function getCustomNames(): Record<string, string> {
  try { const raw = localStorage.getItem(AGENT_NAMES_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function setCustomName(connId: string, agentId: string, name: string) {
  const names = getCustomNames(); names[`${connId}:${agentId}`] = name;
  localStorage.setItem(AGENT_NAMES_KEY, JSON.stringify(names));
  window.dispatchEvent(new CustomEvent('openclaw:agent-names-updated'));
}
function getFavorites(): Set<string> {
  try { const raw = localStorage.getItem(AGENT_FAVORITES_KEY); return new Set(raw ? JSON.parse(raw) : []); } catch { return new Set(); }
}
function setFavoriteStorage(connId: string, agentId: string, val: boolean) {
  const favs = getFavorites();
  const key = `${connId}:${agentId}`;
  if (val) favs.add(key); else favs.delete(key);
  localStorage.setItem(AGENT_FAVORITES_KEY, JSON.stringify([...favs]));
}

// ── Reorder sub-components (need hooks, must be React components) ──────────

interface ReorderListCardProps {
  agent: AgentInfo;
  displayName: string;
  isFav: boolean;
  compact: boolean;
  renderAvatar: (agent: AgentInfo, size: 'sm' | 'md' | 'lg' | 'xl') => React.ReactNode;
  onFavToggle: () => void;
  onAvatarClick: () => void;
  onNameSave: (name: string) => void;
}

function ReorderListCard({ agent, displayName, isFav, compact, renderAvatar, onFavToggle, onAvatarClick, onNameSave }: ReorderListCardProps) {
  const controls = useDragControls();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);
  // Keep nameInput in sync if parent updates displayName
  useEffect(() => { setNameInput(displayName); }, [displayName]);

  return (
    <Reorder.Item value={agent.id}
      dragControls={controls}
      dragListener={false}
      whileDrag={{ scale: 1.03, boxShadow: '0 8px 28px rgba(0,0,0,0.18)', zIndex: 50 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      style={{ touchAction: 'pan-y' }}>
      <div className={cn('flex items-center gap-2 rounded-xl border border-border/20 dark:border-border-dark/20', compact ? 'px-2 py-1.5' : 'px-3 py-2', 'bg-surface dark:bg-surface-dark')}>
        {/* Drag handle — only this triggers drag */}
        <div
          className="touch-none cursor-grab active:cursor-grabbing p-1 shrink-0"
          onPointerDown={e => { e.preventDefault(); controls.start(e); }}
        >
          <GripVertical size={15} className="text-text/25 dark:text-text-inv/20" />
        </div>
        {/* Avatar (tap to change) */}
        <button onClick={onAvatarClick} className="shrink-0 rounded-xl overflow-hidden hover:opacity-80 transition-opacity" title="Change avatar">
          {renderAvatar(agent, compact ? 'sm' : 'md')}
        </button>
        {/* Name */}
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={() => {
                const v = nameInput.trim();
                if (v) onNameSave(v);
                setEditingName(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setNameInput(displayName); setEditingName(false); }
              }}
              className={cn('w-full bg-transparent border-b border-primary outline-none font-bold', compact ? 'text-[13px]' : 'text-[15px]')}
            />
          ) : (
            <div className="flex items-center gap-1">
              <h3 className={cn('font-bold truncate', compact ? 'text-[13px]' : 'text-[15px]')}>{displayName}</h3>
              <button onClick={() => setEditingName(true)} className="shrink-0 text-text/20 hover:text-text/50 dark:text-text-inv/15 dark:hover:text-text-inv/50">
                <Pencil size={11} />
              </button>
            </div>
          )}
        </div>
        {/* Favorite */}
        <button
          onClick={onFavToggle}
          className={cn('shrink-0 p-1.5 rounded-lg transition-colors', isFav ? 'text-yellow-400' : 'text-text/20 dark:text-text-inv/15 hover:text-yellow-400')}
        >
          <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
        </button>
      </div>
    </Reorder.Item>
  );
}

interface ReorderGridCardProps {
  agent: AgentInfo;
  displayName: string;
  isFav: boolean;
  renderAvatar: (agent: AgentInfo, size: 'sm' | 'md' | 'lg' | 'xl') => React.ReactNode;
  onFavToggle: () => void;
  onAvatarClick: () => void;
  onNameSave: (name: string) => void;
}

function ReorderGridCard({ agent, displayName, isFav, renderAvatar, onFavToggle, onAvatarClick, onNameSave }: ReorderGridCardProps) {
  const controls = useDragControls();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);
  useEffect(() => { setNameInput(displayName); }, [displayName]);

  return (
    <Reorder.Item value={agent.id}
      dragControls={controls}
      dragListener={false}
      whileDrag={{ scale: 1.08, boxShadow: '0 12px 36px rgba(0,0,0,0.2)', zIndex: 50 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      style={{ touchAction: 'pan-y' }}>
      <div className="relative flex flex-col items-center p-3 pb-2 rounded-2xl bg-surface dark:bg-surface-dark">
        {/* Drag handle top-left */}
        <div
          className="absolute top-2 left-2 touch-none cursor-grab active:cursor-grabbing p-0.5"
          onPointerDown={e => { e.preventDefault(); controls.start(e); }}
        >
          <GripVertical size={13} className="text-text/20 dark:text-text-inv/15" />
        </div>
        {/* Favorite top-right */}
        <button
          onClick={onFavToggle}
          className={cn('absolute top-2 right-2 p-0.5 rounded transition-colors', isFav ? 'text-yellow-400' : 'text-text/15 dark:text-text-inv/10 hover:text-yellow-400')}
        >
          <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
        </button>
        {/* Avatar */}
        <button onClick={onAvatarClick} className="mt-3 rounded-2xl overflow-hidden hover:opacity-80 transition-opacity">
          {renderAvatar(agent, 'xl')}
        </button>
        {/* Name */}
        {editingName ? (
          <input
            autoFocus
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onBlur={() => {
              const v = nameInput.trim();
              if (v) onNameSave(v);
              setEditingName(false);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { setNameInput(displayName); setEditingName(false); }
            }}
            className="mt-1.5 w-full text-center bg-transparent border-b border-primary outline-none text-[12px] font-semibold"
          />
        ) : (
          <button onClick={() => setEditingName(true)} className="mt-1.5 flex items-center gap-1 hover:opacity-70">
            <span className="text-[12px] font-semibold truncate max-w-[80px]">{displayName}</span>
            <Pencil size={9} className="text-text/30 dark:text-text-inv/25 shrink-0" />
          </button>
        )}
      </div>
    </Reorder.Item>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-1 h-1 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: '600ms' }} />
      ))}
    </span>
  );
}

const AVATAR_PALETTES = [
  { from: '#EF5A23', to: '#D04A1A' },
  { from: '#5B8DEF', to: '#3b6fd0' },
  { from: '#8B5CF6', to: '#6D28D9' },
  { from: '#F59E0B', to: '#D97706' },
  { from: '#EC4899', to: '#BE185D' },
  { from: '#14B8A6', to: '#0D9488' },
  { from: '#F97316', to: '#EA580C' },
  { from: '#6366F1', to: '#4F46E5' },
] as const;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
  return Math.abs(hash);
}
function getAgentPalette(agentId: string) { return AVATAR_PALETTES[hashString(agentId) % AVATAR_PALETTES.length]; }

function formatRelativeTime(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getPreviewKey(connectionId: string, agentId: string) { return `${PREVIEW_KEY_PREFIX}${connectionId}.${agentId}`; }
function getPreviewStateKey(connectionId: string, agentId: string) { return `${connectionId}:${agentId}`; }
function getStoredPreview(agentId: string, connectionId: string): { text: string; timestamp?: number } | null {
  try {
    const c = localStorage.getItem(getPreviewKey(connectionId, agentId));
    if (!c) return null;
    const parsed = JSON.parse(c) as { text: string; timestamp?: number };
    // Filter out stale system messages (🐾, [Image], etc.)
    const t = parsed.text?.trim();
    if (t && (t.startsWith('🐾') || t === '[Image]' || t === '[image]' || t.startsWith('📎') || t.endsWith('*[cancelled]*'))) {
      return null;
    }
    return parsed;
  } catch {}
  return null;
}
function getAgentOrderKey(connectionId: string) { return `${AGENT_ORDER_KEY_PREFIX}${connectionId}`; }
function getStoredAgentOrder(connectionId: string): string[] {
  try {
    const raw = localStorage.getItem(getAgentOrderKey(connectionId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  try {
    const legacyRaw = localStorage.getItem(LEGACY_AGENT_ORDER_KEY);
    if (!legacyRaw) return [];
    const legacyParsed = JSON.parse(legacyRaw);
    const legacyOrder = legacyParsed?.[connectionId];
    return Array.isArray(legacyOrder) ? legacyOrder : [];
  } catch {}
  return [];
}

const LAST_READ_PREFIX = 'clawline.lastRead.';
function getLastReadKey(connectionId: string, agentId: string) { return `${LAST_READ_PREFIX}${connectionId}.${agentId}`; }
export function markAgentAsRead(connectionId: string, agentId: string, messageTs?: number) {
  // S8: Use server message timestamp when available to avoid clock skew
  const ts = messageTs || Date.now();
  try { localStorage.setItem(getLastReadKey(connectionId, agentId), ts.toString()); } catch {}
}
function getLastReadTimestamp(connectionId: string, agentId: string): number {
  try { const v = localStorage.getItem(getLastReadKey(connectionId, agentId)); return v ? parseInt(v, 10) : 0; } catch { return 0; }
}
function hasUnread(connectionId: string, agentId: string, lastMessageTs?: number): boolean {
  if (!lastMessageTs) return false;
  return lastMessageTs > getLastReadTimestamp(connectionId, agentId);
}
function getConnectionLabel(c: ServerConnection) { return c.name || c.displayName || 'Server'; }

/** Resolve the display name for an agent. Custom name > agent name > server name (for default agent only). */
function resolveAgentName(agent: AgentInfo, connection: ServerConnection, customNames: Record<string, string>) {
  const key = `${connection.id}:${agent.id}`;
  if (customNames[key]) return customNames[key];
  // Only for the default agent: if name is generic (equals ID, e.g. "main"), use server name
  if (agent.isDefault && agent.name === agent.id) return connection.name || connection.displayName || agent.name;
  return agent.name;
}
function getStatusClasses(status: ChannelStatus) {
  if (status === 'connected') return 'bg-primary';
  if (status === 'connecting' || status === 'reconnecting') return 'bg-amber-400';
  return 'bg-text/20 dark:bg-text-inv/20';
}
function buildAgentMap(connections: ServerConnection[]) {
  return Object.fromEntries(connections.map(c => [c.id, channel.loadCachedAgents(c.id)])) as Record<string, AgentInfo[]>;
}
function buildStatusMap(connections: ServerConnection[]) {
  return Object.fromEntries(connections.map(c => [c.id, channel.getStatus(c.id)])) as Record<string, ChannelStatus>;
}
function buildLoadingMap(connections: ServerConnection[]) {
  return Object.fromEntries(connections.map(c => [c.id, channel.loadCachedAgents(c.id).length === 0])) as Record<string, boolean>;
}

// ── Component ────────────────────────────────────────────────────────

export default function ChatList({
  onOpenChat, onOpenSplitChat, onAddServer, compact,
  activeAgentId, activeConnectionId, splitEnabled, splitAwaitingAgent,
  splitPanes, onFocusSplitPane,
}: {
  onOpenChat: (connectionId: string, agentId: string, chatId?: string) => void;
  onOpenSplitChat?: (connectionId: string, agentId: string, chatId?: string) => void;
  onFocusSplitPane?: (connectionId: string, agentId: string) => void;
  onAddServer: () => void;
  compact?: boolean;
  activeAgentId?: string | null;
  activeConnectionId?: string | null;
  splitEnabled?: boolean;
  splitAwaitingAgent?: boolean;
  splitPanes?: { connectionId: string; agentId: string; chatId: string | null }[];
}) {
  // ── State ──
  const [connections, setConnections] = useState<ServerConnection[]>(() => getConnections());
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || 'list'; } catch { return 'list'; }
  });
  const [expandedIds, setExpandedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(EXPANDED_KEY);
      if (saved) { const parsed = JSON.parse(saved); if (Array.isArray(parsed) && parsed.length > 0) return parsed; }
    } catch {}
    const init = getConnections();
    if (init.length <= 1) return init[0] ? [init[0].id] : [];
    return activeConnectionId ? [activeConnectionId] : [];
  });
  const [agentMap, setAgentMap] = useState<Record<string, AgentInfo[]>>(() => buildAgentMap(getConnections()));
  const [statusMap, setStatusMap] = useState<Record<string, ChannelStatus>>(() => buildStatusMap(getConnections()));
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>(() => buildLoadingMap(getConnections()));
  const [refreshingMap, setRefreshingMap] = useState<Record<string, boolean>>({});
  const [attemptedMap, setAttemptedMap] = useState<Record<string, boolean>>({});
  const [typingAgents, setTypingAgents] = useState<Set<string>>(new Set());
  const [previewMap, setPreviewMap] = useState<Record<string, { text: string; timestamp?: number } | null>>({});
  const [customOrder, setCustomOrder] = useState<Record<string, string[]>>(() => (
    Object.fromEntries(
      getConnections()
        .map((connection) => [connection.id, getStoredAgentOrder(connection.id)] as const)
        .filter(([, order]) => order.length > 0),
    )
  ));
  const [customAvatars, setCustomAvatarsState] = useState<Record<string, string>>(() => getCustomAvatars());
  const [customNames, setCustomNamesState] = useState<Record<string, string>>(() => getCustomNames());
  const [favorites, setFavoritesState] = useState<Set<string>>(() => getFavorites());
  const [avatarMenuAgent, setAvatarMenuAgent] = useState<{ agentId: string; connectionId: string; x: number; y: number } | null>(null);
  const [avatarUploadAgent, setAvatarUploadAgent] = useState<string | null>(null);
  const [reorderMode, setReorderMode] = useState(false);

  // ── Refs (stable references for effect callbacks) ──
  const pendingOpenRef = useRef<Record<string, PendingOpen | undefined>>({});
  const agentMapRef = useRef(agentMap);
  const onOpenChatRef = useRef(onOpenChat);
  const onOpenSplitChatRef = useRef(onOpenSplitChat);
  const searchQueryRef = useRef(searchQuery);
  const expandedIdsRef = useRef(expandedIds);

  useEffect(() => { agentMapRef.current = agentMap; }, [agentMap]);
  useEffect(() => { onOpenChatRef.current = onOpenChat; }, [onOpenChat]);
  useEffect(() => { onOpenSplitChatRef.current = onOpenSplitChat; }, [onOpenSplitChat]);
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { expandedIdsRef.current = expandedIds; }, [expandedIds]);

  // ── Avatar context menu ──
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAvatarContextMenu = (e: React.MouseEvent, connectionId: string, agentId: string) => {
    e.preventDefault(); e.stopPropagation();
    setAvatarMenuAgent({ agentId, connectionId, x: e.clientX, y: e.clientY });
  };
  const handleAvatarTouchStart = (e: React.TouchEvent, connectionId: string, agentId: string) => {
    const t = e.touches[0];
    longPressTimerRef.current = setTimeout(() => setAvatarMenuAgent({ agentId, connectionId, x: t.clientX, y: t.clientY }), 500);
  };
  const handleAvatarTouchEnd = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  };
  const handleSetCustomAvatar = (connectionId: string, agentId: string) => { setAvatarMenuAgent(null); setAvatarUploadAgent(`${connectionId}:${agentId}`); };
  const handleAvatarSave = (dataUrl: string) => {
    if (!avatarUploadAgent) return;
    setCustomAvatar(avatarUploadAgent.split(':')[0], avatarUploadAgent.split(':').slice(1).join(':'), dataUrl);
    setCustomAvatarsState(getCustomAvatars());
  };
  const handleRemoveCustomAvatar = (connectionId: string, agentId: string) => {
    removeCustomAvatar(connectionId, agentId); setCustomAvatarsState(getCustomAvatars()); setAvatarMenuAgent(null);
  };
  useEffect(() => {
    if (!avatarMenuAgent) return;
    const close = () => setAvatarMenuAgent(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [avatarMenuAgent]);

  // ── Connection sync ──
  const syncConnections = useCallback(() => {
    const next = getConnections();
    setConnections(next);
    setAgentMap(prev => {
      const n = { ...prev };
      Object.keys(n).forEach(k => { if (!next.some(c => c.id === k)) delete n[k]; });
      next.forEach(c => { if (!n[c.id]) n[c.id] = channel.loadCachedAgents(c.id); });
      return n;
    });
    setStatusMap(prev => Object.fromEntries(next.map(c => [c.id, prev[c.id] || channel.getStatus(c.id)])) as Record<string, ChannelStatus>);
    setLoadingMap(prev => Object.fromEntries(next.map(c => [c.id, prev[c.id] ?? channel.loadCachedAgents(c.id).length === 0])) as Record<string, boolean>);
    setRefreshingMap(prev => Object.fromEntries(next.map(c => [c.id, prev[c.id] ?? false])) as Record<string, boolean>);
    setAttemptedMap(prev => Object.fromEntries(next.map(c => [c.id, prev[c.id] ?? false])) as Record<string, boolean>);
    setCustomOrder((prev) => {
      const nextOrder: Record<string, string[]> = {};
      next.forEach((connection) => {
        const saved = prev[connection.id] ?? getStoredAgentOrder(connection.id);
        if (saved.length > 0) {
          nextOrder[connection.id] = saved;
        }
      });
      return nextOrder;
    });
    setExpandedIds(prev => {
      if (next.length <= 1) return next[0] ? [next[0].id] : [];
      const filtered = prev.filter(id => next.some(c => c.id === id));
      if (filtered.length > 0) return filtered;
      return activeConnectionId && next.some(c => c.id === activeConnectionId) ? [activeConnectionId] : [];
    });
  }, [activeConnectionId]);

  useEffect(() => {
    syncConnections();
    const h = () => syncConnections();
    window.addEventListener(CONNECTIONS_UPDATED_EVENT, h);
    return () => window.removeEventListener(CONNECTIONS_UPDATED_EVENT, h);
  }, [syncConnections]);

  // ── Typing sync ──
  useEffect(() => {
    const sync = () => {
      const next = new Set<string>();
      connections.forEach(c => channel.getTypingAgents(c.id).forEach(a => next.add(getPreviewStateKey(c.id, a))));
      setTypingAgents(next);
    };
    sync();
    return channel.onTypingChange((cid, agentIds) => {
      setTypingAgents(prev => {
        const next = new Set(prev);
        [...next].forEach(k => { if (k.startsWith(`${cid}:`)) next.delete(k); });
        agentIds.forEach(a => next.add(getPreviewStateKey(cid, a)));
        return next;
      });
    });
  }, [connections]);

  // ── Thinking sync ──
  const [thinkingAgents, setThinkingAgents] = useState<Set<string>>(new Set());
  useEffect(() => {
    const sync = () => {
      const next = new Set<string>();
      connections.forEach(c => channel.getThinkingAgents(c.id).forEach(a => next.add(getPreviewStateKey(c.id, a))));
      setThinkingAgents(next);
    };
    sync();
    return channel.onThinkingChange((cid, agentIds) => {
      setThinkingAgents(prev => {
        const next = new Set(prev);
        [...next].forEach(k => { if (k.startsWith(`${cid}:`)) next.delete(k); });
        agentIds.forEach(a => next.add(getPreviewStateKey(cid, a)));
        return next;
      });
    });
  }, [connections]);

  // ── Agent loading ──
  const ensureAgentsLoaded = useCallback((connection: ServerConnection, force = false) => {
    // P0 fix: Prevent repeated requests when already refreshing
    if (!force && (agentMapRef.current[connection.id]?.length ?? 0) > 0) return;
    if (!force && refreshingMap[connection.id]) return; // Already refreshing, skip
    setAttemptedMap(p => ({ ...p, [connection.id]: true }));
    setLoadingMap(p => ({ ...p, [connection.id]: force ? true : p[connection.id] && (agentMapRef.current[connection.id]?.length ?? 0) === 0 }));
    setRefreshingMap(p => ({ ...p, [connection.id]: true }));
    const status = channel.getStatus(connection.id);
    if (status !== 'connected' && status !== 'connecting') {
      channel.connect({ connectionId: connection.id, chatId: connection.chatId, channelId: connection.channelId, senderId: connection.senderId || getUserId(), senderName: connection.displayName, serverUrl: connection.serverUrl, token: connection.token });
      return;
    }
    if (status === 'connected') {
      try { channel.requestAgentList(connection.id); } catch {
        setRefreshingMap(p => ({ ...p, [connection.id]: false }));
        setLoadingMap(p => ({ ...p, [connection.id]: false }));
      }
    }
  }, [refreshingMap]);

  useEffect(() => {
    if (connections.length === 1 && connections[0]) { ensureAgentsLoaded(connections[0]); return; }
    if (searchQuery.trim()) { connections.forEach(c => ensureAgentsLoaded(c)); return; }
    expandedIdsRef.current.forEach(id => { const c = connections.find(x => x.id === id); if (c) ensureAgentsLoaded(c); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, ensureAgentsLoaded]);

  // ── Message / status subscriptions (stable — only re-sub on connections change) ──
  useEffect(() => {
    const cleanups = connections.map(connection => {
      const unMsg = channel.onMessage((packet) => {
        if (packet.type === 'connection.open') {
          if (pendingOpenRef.current[connection.id]) {
            try { channel.requestConversationList(pendingOpenRef.current[connection.id]?.agentId, connection.id); }
            catch { setRefreshingMap(p => ({ ...p, [connection.id]: false })); }
          } else if (searchQueryRef.current.trim() || expandedIdsRef.current.includes(connection.id) || connections.length === 1) {
            try { channel.requestAgentList(connection.id); }
            catch { setRefreshingMap(p => ({ ...p, [connection.id]: false })); setLoadingMap(p => ({ ...p, [connection.id]: false })); }
          }
        } else if (packet.type === 'agent.list') {
          const agents = Array.isArray((packet.data as { agents?: AgentInfo[] }).agents) ? (packet.data as { agents: AgentInfo[] }).agents : [];
          setAgentMap(p => ({ ...p, [connection.id]: agents }));
          channel.saveCachedAgents(connection.id, agents);
          setLoadingMap(p => ({ ...p, [connection.id]: false }));
          setRefreshingMap(p => ({ ...p, [connection.id]: false }));
        } else if (packet.type === 'conversation.list') {
          const pending = pendingOpenRef.current[connection.id];
          if (!pending) return;
          const convos = (Array.isArray((packet.data as { conversations?: ConversationSummary[] }).conversations)
            ? (packet.data as { conversations: ConversationSummary[] }).conversations : [])
            .slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          pendingOpenRef.current[connection.id] = undefined;
          setRefreshingMap(p => ({ ...p, [connection.id]: false }));
          if (pending.target === 'split' && onOpenSplitChatRef.current) {
            onOpenSplitChatRef.current(connection.id, pending.agentId, convos[0]?.chatId);
            return;
          }
          setActiveConnectionId(connection.id);
          onOpenChatRef.current(connection.id, pending.agentId, convos[0]?.chatId);
        }
      }, connection.id);

      const unStatus = channel.onStatus((status) => {
        setStatusMap(p => ({ ...p, [connection.id]: status }));
        if (status === 'connected' && pendingOpenRef.current[connection.id]) {
          try { channel.requestConversationList(pendingOpenRef.current[connection.id]?.agentId, connection.id); }
          catch { setRefreshingMap(p => ({ ...p, [connection.id]: false })); }
        }
        if (status === 'disconnected') {
          setRefreshingMap(p => ({ ...p, [connection.id]: false }));
          setLoadingMap(p => ({ ...p, [connection.id]: false }));
        }
      }, connection.id);

      return () => { unMsg(); unStatus(); };
    });
    return () => cleanups.forEach(fn => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections]);

  // ── Preview loading ──
  useEffect(() => {
    const targets = connections.flatMap(c => (agentMap[c.id] || []).map(a => ({ connectionId: c.id, agentId: a.id })));
    if (!targets.length) { setPreviewMap({}); return; }
    setPreviewMap(Object.fromEntries(targets.map(t => [getPreviewStateKey(t.connectionId, t.agentId), getStoredPreview(t.agentId, t.connectionId)])));
  }, [agentMap, connections]);

  useEffect(() => {
    const handler = (event: Event) => {
      const { connectionId, agentId } = (event as CustomEvent<{ connectionId?: string; agentId?: string }>).detail ?? {};
      if (!connectionId || !agentId) return;
      setPreviewMap(prev => ({ ...prev, [getPreviewStateKey(connectionId, agentId)]: getStoredPreview(agentId, connectionId) }));
    };
    window.addEventListener(MESSAGE_PREVIEW_UPDATED_EVENT, handler);
    return () => window.removeEventListener(MESSAGE_PREVIEW_UPDATED_EVENT, handler);
  }, []);

  // ── Derived ──
  const filteredResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return connections.flatMap(c => (agentMap[c.id] || []).filter(a => {
      const displayName = customNames[`${c.id}:${a.id}`] || a.name;
      return displayName.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q) || (c.displayName || '').toLowerCase().includes(q);
    }).map(a => ({ agent: a, connection: c })));
  }, [agentMap, connections, searchQuery, customNames]);

  const connectedCount = connections.filter(c => statusMap[c.id] === 'connected').length;
  const showGroupedView = connections.length > 1 && !searchQuery.trim();

  // ── Global favorites (cross-server) ──
  const favoriteAgents = useMemo(() => {
    if (favorites.size === 0) return [];
    const result: { agent: AgentInfo; connection: ServerConnection }[] = [];
    for (const conn of connections) {
      const agents = agentMap[conn.id] || [];
      for (const agent of agents) {
        if (favorites.has(`${conn.id}:${agent.id}`)) {
          result.push({ agent, connection: conn });
        }
      }
    }
    return result;
  }, [favorites, connections, agentMap]);

  // ── Handlers ──
  const handleRefresh = () => {
    const targets = searchQuery.trim() ? connections : connections.length === 1 ? connections : connections.filter(c => expandedIds.includes(c.id));
    targets.forEach(c => ensureAgentsLoaded(c, true));
  };

  const handleToggleGroup = (connectionId: string) => {
    setExpandedIds(prev => {
      const expanding = !prev.includes(connectionId);
      const next = expanding ? [...prev, connectionId] : prev.filter(id => id !== connectionId);
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(next)); } catch {}
      if (expanding) { const c = connections.find(x => x.id === connectionId); if (c) ensureAgentsLoaded(c); }
      return next;
    });
  };

  const handleAgentClick = (connection: ServerConnection, agent: AgentInfo, shiftKey = false) => {
    if (reorderMode) return; // safety guard — shouldn't happen since button is disabled
    const status = statusMap[connection.id] || 'disconnected';
    if (attemptedMap[connection.id] && status === 'disconnected') return;
    const isCurrentlyActive = activeConnectionId === connection.id && activeAgentId === agent.id;
    const isAlreadyInSplit = (splitPanes ?? []).some((p) => p.connectionId === connection.id && p.agentId === agent.id);

    // Already open in a split pane — focus that pane's input instead
    if (isAlreadyInSplit) {
      onFocusSplitPane?.(connection.id, agent.id);
      return;
    }

    const target: PendingOpen['target'] = (splitAwaitingAgent && !isCurrentlyActive && !isAlreadyInSplit && onOpenSplitChat)
      ? 'split'
      : (shiftKey && splitEnabled && onOpenSplitChat ? 'split' : 'primary');

    if (status === 'connected') {
      // Already connected: switch agent + navigate. Pass undefined chatId so
      // ChatRoom resolves the agent's actual conversation via the channel
      // (connection.chatId is the channel root, not the agent's chat).
      if (target === 'split' && onOpenSplitChat) {
        // Don't selectAgent on the base connection — split pane manages its own connection
        onOpenSplitChat(connection.id, agent.id, undefined);
      } else {
        channel.selectAgent(agent.id, connection.id);
        onOpenChat(connection.id, agent.id, undefined);
      }
      return;
    }

    // Not connected: establish connection, pendingOpen tracks the agent to open
    pendingOpenRef.current[connection.id] = { agentId: agent.id, target };
    setRefreshingMap(p => ({ ...p, [connection.id]: true }));
    channel.connect({
      connectionId: connection.id,
      chatId: connection.chatId,
      channelId: connection.channelId,
      senderId: connection.senderId || getUserId(),
      senderName: connection.displayName,
      serverUrl: connection.serverUrl,
      token: connection.token,
      // Note: agentId not passed — agent is selected after connection via selectAgent()
    });
  };

  const toggleViewMode = () => {
    const next: ViewMode = viewMode === 'list' ? 'grid' : 'list';
    setViewMode(next);
    try { localStorage.setItem(VIEW_MODE_KEY, next); } catch {}
  };

  const handleReorder = useCallback((connectionId: string, newOrder: string[]) => {
    setCustomOrder(prev => {
      const updated = { ...prev, [connectionId]: newOrder };
      try { localStorage.setItem(getAgentOrderKey(connectionId), JSON.stringify(newOrder)); } catch {}
      return updated;
    });
  }, []);

  const getSortedAgentIds = useCallback((connectionId: string): string[] => {
    const agents = agentMap[connectionId] || [];
    const order = customOrder[connectionId];
    const sorted = order
      ? [...agents].sort((a, b) => {
          const ai = order.indexOf(a.id); const bi = order.indexOf(b.id);
          if (ai === -1 && bi === -1) return 0; if (ai === -1) return 1; if (bi === -1) return -1;
          return ai - bi;
        }).map(a => a.id)
      : agents.map(a => a.id);
    // Favorites float to top
    return sorted.sort((a, b) => {
      const af = favorites.has(`${connectionId}:${a}`); const bf = favorites.has(`${connectionId}:${b}`);
      if (af && !bf) return -1; if (!af && bf) return 1;
      return 0;
    });
  }, [agentMap, customOrder, favorites]);

  const getAgentById = useCallback((connectionId: string, agentId: string) => {
    return (agentMap[connectionId] || []).find(a => a.id === agentId);
  }, [agentMap]);

  // ── Shared avatar renderer ──
  const renderAvatar = (agent: AgentInfo, size: 'sm' | 'md' | 'lg' | 'xl', connectionId?: string) => {
    const palette = getAgentPalette(agent.id);
    const initials = agent.name.slice(0, 2).toUpperCase();
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-[11px] rounded-lg' : size === 'md' ? 'w-10 h-10 text-[13px] rounded-xl' : size === 'lg' ? 'w-12 h-12 text-base rounded-2xl' : 'w-14 h-14 text-lg rounded-2xl';
    const avatarKey = connectionId ? `${connectionId}:${agent.id}` : agent.id;
    if (customAvatars[avatarKey]) {
      return <img src={customAvatars[avatarKey]} alt={agent.name} className={cn('object-cover', sizeClasses)} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />;
    }
    return (
      <div className={cn('flex items-center justify-center text-white font-semibold shadow-sm', sizeClasses)}
        style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}>
        {agent.identityEmoji || initials}
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════
  // NORMAL MODE — click cards + drag handles
  // ══════════════════════════════════════════════════════════════════

  const renderListCard = (
    connection: ServerConnection,
    agent: AgentInfo,
    index: number,
    showSource = false,
    onDragHandlePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void,
  ) => {
    const status = statusMap[connection.id] || 'disconnected';
    const isDisabled = attemptedMap[connection.id] && status === 'disconnected';
    const isActive = activeConnectionId === connection.id && activeAgentId === agent.id;
    const isSplitActive = (splitPanes ?? []).some((p) => p.connectionId === connection.id && p.agentId === agent.id);
    const previewKey = getPreviewStateKey(connection.id, agent.id);
    const lastMessage = Object.prototype.hasOwnProperty.call(previewMap, previewKey) ? previewMap[previewKey] : getStoredPreview(agent.id, connection.id);
    const rawPreview = lastMessage?.text ? stripMarkdownForPreview(lastMessage.text) : null;
    const preview = rawPreview ? (rawPreview.length > 50 ? `${rawPreview.slice(0, 50)}…` : rawPreview) : null;
    const isTyping = typingAgents.has(previewKey);
    const isThinking = thinkingAgents.has(previewKey);
    const showStatus = isThinking || isTyping;
    const showOnlineDot = !showStatus && status === 'connected';
    const unread = !isActive && hasUnread(connection.id, agent.id, lastMessage?.timestamp);

    return (
      <motion.div key={agent.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }} transition={{ delay: Math.min(index * 0.02, 0.12), duration: 0.18 }}>
        <div className="group flex items-stretch gap-1.5">
          <button type="button" onClick={e => handleAgentClick(connection, agent, e.shiftKey)} disabled={isDisabled}
            aria-label={`Chat with ${agent.name}`}
            className={cn(
              'relative w-full flex-1 text-left flex items-center gap-3 transition-all duration-150',
              compact ? 'px-3 py-2.5' : 'px-5 py-3', 'rounded-lg',
              'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
              isDisabled && 'opacity-40 cursor-not-allowed',
              !isDisabled && 'cursor-pointer active:bg-text/[0.06] dark:active:bg-text-inv/[0.06]',
              isActive ? 'bg-primary/12 dark:bg-primary/15 shadow-[inset_2px_0_0_0_#EF5A23]'
                : isSplitActive ? 'bg-info/8 dark:bg-info/12 shadow-[inset_2px_0_0_0_#5B8DEF]'
                : 'hover:bg-text/[0.05] dark:hover:bg-text-inv/[0.05] hover:shadow-sm'
            )}>
            {/* Avatar */}
            <div className="relative flex-shrink-0" onContextMenu={e => handleAvatarContextMenu(e, connection.id, agent.id)}
              onTouchStart={e => handleAvatarTouchStart(e, connection.id, agent.id)} onTouchEnd={handleAvatarTouchEnd} onTouchMove={handleAvatarTouchEnd}>
              {renderAvatar(agent, compact ? 'sm' : 'md', connection.id)}
              {agent.isDefault && (
                <span className={cn('absolute -top-1 -right-1 flex items-center justify-center rounded-full bg-amber-400 border-[1.5px] border-white dark:border-surface-dark shadow-sm', compact ? 'w-3.5 h-3.5' : 'w-4 h-4')}>
                  <Crown size={compact ? 7 : 8} className="text-white" strokeWidth={2.5} />
                </span>
              )}
              {showStatus && (
                <span className={cn('absolute -bottom-0.5 -right-0.5 bg-primary rounded-full border-2 border-white dark:border-surface-dark flex items-center justify-center', compact ? 'w-3 h-3' : 'w-3.5 h-3.5')}>
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                </span>
              )}
              {showOnlineDot && (
                <span className={cn('absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white dark:border-surface-dark bg-primary', compact ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
              )}
            </div>
            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className={cn('font-bold truncate', compact ? 'text-[14px] text-text/90 dark:text-text-inv/90' : 'text-[16px]')}>{resolveAgentName(agent, connection, customNames)}</h3>
                {agent.model && <span className="text-[10px] truncate ml-auto shrink-0 bg-text/5 dark:bg-text-inv/5 rounded-full px-2 py-px text-text/45 dark:text-text-inv/40">{agent.model.split('/').pop()}</span>}
              </div>
              {isThinking ? (
                <p className={cn('mt-0.5 text-primary flex items-center gap-1', compact ? 'text-[12px]' : 'text-[14px]')}>Thinking... <TypingDots /></p>
              ) : isTyping ? (
                <p className={cn('mt-0.5 text-primary flex items-center gap-1', compact ? 'text-[12px]' : 'text-[14px]')}>Typing... <TypingDots /></p>
              ) : preview ? (
                <p className={cn('truncate mt-0.5', compact ? 'text-[12px] text-text/45 dark:text-text-inv/40' : 'text-[14px] text-text/45 dark:text-text-inv/40')}>{preview}</p>
              ) : (
                <p className={cn('truncate mt-0.5', compact ? 'text-[12px] text-text/30 dark:text-text-inv/25' : 'text-[14px] text-text/30 dark:text-text-inv/25')}>Start a conversation</p>
              )}
            </div>
            {/* Timestamp */}
            {lastMessage?.timestamp && (
              <span className={cn('text-[10px] shrink-0 self-start mt-0.5', compact ? 'text-text/30 dark:text-text-inv/25' : 'text-text/30 dark:text-text-inv/25')}>
                {formatRelativeTime(lastMessage.timestamp)}
              </span>
            )}
          </button>
          {onDragHandlePointerDown && (
            <div
              role="button"
              aria-label={`Reorder ${agent.name}`}
              title="Drag to reorder"
              onPointerDown={onDragHandlePointerDown}
              onClick={(e) => e.preventDefault()}
              className="flex shrink-0 cursor-grab items-center px-1.5 text-text/20 transition-colors hover:text-text/45 active:cursor-grabbing active:text-primary dark:text-text-inv/20 dark:hover:text-text-inv/45"
              style={{ touchAction: 'none' }}
            >
              <ArrowUpDown size={13} />
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  const renderGridCard = (
    connection: ServerConnection,
    agent: AgentInfo,
    index: number,
    onDragHandlePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void,
  ) => {
    const status = statusMap[connection.id] || 'disconnected';
    const isDisabled = attemptedMap[connection.id] && status === 'disconnected';
    const isActive = activeConnectionId === connection.id && activeAgentId === agent.id;
    const isSplitActive = (splitPanes ?? []).some((p) => p.connectionId === connection.id && p.agentId === agent.id);
    const previewKey = getPreviewStateKey(connection.id, agent.id);
    const lastMessage = Object.prototype.hasOwnProperty.call(previewMap, previewKey) ? previewMap[previewKey] : getStoredPreview(agent.id, connection.id);
    const isTyping = typingAgents.has(previewKey);
    const isThinking = thinkingAgents.has(previewKey);
    const showStatus = isThinking || isTyping;

    return (
      <motion.div key={agent.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: Math.min(index * 0.03, 0.15), duration: 0.2 }}>
        <div className="relative">
          <button type="button" onClick={e => handleAgentClick(connection, agent, e.shiftKey)} disabled={isDisabled}
            aria-label={`Chat with ${agent.name}`}
            className={cn(
              'relative w-full flex flex-col items-center text-center p-3 pb-2.5 rounded-2xl transition-all duration-150',
              'bg-white/60 dark:bg-card-alt/40',
              'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
              isDisabled && 'opacity-40 cursor-not-allowed',
              !isDisabled && 'cursor-pointer active:scale-[0.96]',
              isActive ? 'ring-2 ring-primary/30 bg-primary/5 dark:bg-primary/10'
                : isSplitActive ? 'ring-2 ring-info/25 bg-info/6 dark:bg-info/10'
                : 'hover:bg-text/[0.03] dark:hover:bg-text-inv/[0.03] hover:shadow-md hover:-translate-y-0.5'
            )}>
            <div className="relative mb-2" onContextMenu={e => handleAvatarContextMenu(e, connection.id, agent.id)}
              onTouchStart={e => handleAvatarTouchStart(e, connection.id, agent.id)} onTouchEnd={handleAvatarTouchEnd} onTouchMove={handleAvatarTouchEnd}>
              {renderAvatar(agent, 'lg', connection.id)}
              {agent.isDefault && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 border-[1.5px] border-white dark:border-card-alt shadow-sm">
                  <Crown size={8} className="text-white" strokeWidth={2.5} />
                </span>
              )}
              {showStatus && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white dark:border-card-alt animate-pulse" />}
            </div>
            <h3 className="text-[12px] font-semibold truncate w-full leading-tight">{resolveAgentName(agent, connection, customNames)}</h3>
            {isThinking ? (
              <div className="mt-1.5 px-2 py-1 rounded-lg bg-text/[0.04] dark:bg-text-inv/[0.04] text-[10px] text-primary flex items-center gap-1">Thinking... <TypingDots /></div>
            ) : isTyping ? (
              <div className="mt-1.5 px-2 py-1 rounded-lg bg-text/[0.04] dark:bg-text-inv/[0.04] text-[10px] text-primary flex items-center gap-1">Typing... <TypingDots /></div>
            ) : lastMessage?.text ? (
              <p className="mt-1 text-[10px] text-text/45 dark:text-text-inv/40 truncate w-full max-w-full">
                {(() => { const t = stripMarkdownForPreview(lastMessage.text); return t.length > 24 ? `${t.slice(0, 24)}…` : t; })()}
              </p>
            ) : agent.model ? (
              <span className="text-[9px] text-text/50 dark:text-text-inv/40 truncate w-full mt-1">{agent.model.split('/').pop()}</span>
            ) : null}
          </button>
          {onDragHandlePointerDown && (
            <div
              role="button"
              aria-label={`Reorder ${agent.name}`}
              title="Drag to reorder"
              onPointerDown={onDragHandlePointerDown}
              onClick={(e) => e.preventDefault()}
              className="absolute top-2 right-2 flex h-7 w-7 cursor-grab items-center justify-center rounded-full bg-white/88 text-text/25 shadow-sm transition-colors hover:text-text/50 active:cursor-grabbing active:text-primary dark:bg-card-alt/88 dark:text-text-inv/25 dark:hover:text-text-inv/50"
              style={{ touchAction: 'none' }}
            >
              <ArrowUpDown size={12} />
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  // ══════════════════════════════════════════════════════════════════
  // REORDER MODE — Reorder.Item, NO click navigation
  // ══════════════════════════════════════════════════════════════════

  const renderReorderListCard = (connectionId: string, agent: AgentInfo) => {
    const key = `${connectionId}:${agent.id}`;
    const conn = getConnectionById(connectionId);
    const displayName = conn ? resolveAgentName(agent, conn, customNames) : (customNames[key] || agent.name);
    const isFav = favorites.has(key);
    return (
      <ReorderListCard
        key={agent.id}
        agent={agent}
        displayName={displayName}
        isFav={isFav}
        compact={compact}
        renderAvatar={(a, s) => renderAvatar(a, s, connectionId)}
        onFavToggle={() => { setFavoriteStorage(connectionId, agent.id, !isFav); setFavoritesState(getFavorites()); }}
        onAvatarClick={() => setAvatarUploadAgent(`${connectionId}:${agent.id}`)}
        onNameSave={(name) => { setCustomName(connectionId, agent.id, name); setCustomNamesState(getCustomNames()); }}
      />
    );
  };

  const renderReorderGridCard = (connectionId: string, agent: AgentInfo) => {
    const key = `${connectionId}:${agent.id}`;
    const conn = getConnectionById(connectionId);
    const displayName = conn ? resolveAgentName(agent, conn, customNames) : (customNames[key] || agent.name);
    const isFav = favorites.has(key);
    return (
      <ReorderGridCard
        key={agent.id}
        agent={agent}
        displayName={displayName}
        isFav={isFav}
        renderAvatar={(a, s) => renderAvatar(a, s, connectionId)}
        onFavToggle={() => { setFavoriteStorage(connectionId, agent.id, !isFav); setFavoritesState(getFavorites()); }}
        onAvatarClick={() => setAvatarUploadAgent(`${connectionId}:${agent.id}`)}
        onNameSave={(name) => { setCustomName(connectionId, agent.id, name); setCustomNamesState(getCustomNames()); }}
      />
    );
  };

  // ══════════════════════════════════════════════════════════════════
  // Agent list renderer — switches between modes
  // ══════════════════════════════════════════════════════════════════

  const renderAgentList = (connectionId: string, connection: ServerConnection) => {
    const agents = agentMap[connectionId] || [];
    const sortedIds = getSortedAgentIds(connectionId);
    const isLoading = loadingMap[connectionId] && agents.length === 0;

    if (isLoading) {
      return (
        <div className={cn('flex items-center justify-center gap-2 py-6', viewMode === 'grid' && 'col-span-full')}>
          <Loader2 size={16} className="text-text/50 animate-spin" />
          <span className="text-text/50 dark:text-text-inv/40 text-[12px]">Loading…</span>
        </div>
      );
    }
    if (agents.length === 0) {
      return (
        <div className={cn('text-center py-10', viewMode === 'grid' && 'col-span-full')}>
          <div className="text-3xl mb-2">🤖</div>
          <p className="text-text/50 dark:text-text-inv/45 text-[14px] font-medium">No agents yet</p>
          <p className="text-text/50 dark:text-text-inv/40 text-[12px] mt-1 max-w-[240px] mx-auto">
            Connect to an OpenClaw gateway to start chatting with your AI agents.
          </p>
        </div>
      );
    }

    // ── Reorder mode ──
    if (reorderMode) {
      return (
        <Reorder.Group axis={viewMode === 'grid' ? 'x' : 'y'} values={sortedIds}
          onReorder={newOrder => handleReorder(connectionId, newOrder)}
          className={viewMode === 'grid' ? 'grid gap-2 auto-fill-grid px-1 pb-1' : 'space-y-0.5 pb-1'}>
          {sortedIds.map(id => {
            const a = getAgentById(connectionId, id);
            if (!a) return null;
            return viewMode === 'grid' ? renderReorderGridCard(connectionId, a) : renderReorderListCard(connectionId, a);
          })}
        </Reorder.Group>
      );
    }

    // ── Normal mode — no drag, plain list ──
    return (
      <div className={viewMode === 'grid' ? 'grid gap-2 auto-fill-grid px-1 pb-1' : 'space-y-0.5 pb-1'}>
        {sortedIds.map((id, index) => {
          const a = getAgentById(connectionId, id);
          if (!a) return null;
          return viewMode === 'grid'
            ? renderGridCard(connection, a, index)
            : renderListCard(connection, a, index, false);
        })}
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════

  if (connections.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', !compact && 'pb-24')}>
        <div className={cn('px-5 pb-3', compact ? 'pt-3' : 'pt-6')}>
          {!compact && <h1 className="text-xl font-bold tracking-tight mb-4">Chats</h1>}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-text/[0.06] dark:bg-text-inv/[0.06] flex items-center justify-center mb-4">
            <Server size={28} className="text-text/30 dark:text-text-inv/25" />
          </div>
          <p className="text-[15px] font-medium text-text/60 dark:text-text-inv/50 mb-1">No servers connected</p>
          <p className="text-[13px] text-text/50 dark:text-text-inv/40 mb-5 text-center">Add a server to start chatting with agents</p>
          <button onClick={onAddServer} className="px-5 py-2 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary-deep transition-colors">
            Add Server
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0 overflow-hidden', !compact && 'pb-24')}>
      {/* Header */}
      <div className={cn('sticky top-0 bg-surface/90 dark:bg-surface-dark/90 backdrop-blur-lg z-10', compact ? 'px-3 pt-3 pb-2' : 'px-5 pt-6 pb-3')}>
        <div className="flex justify-between items-center mb-3 gap-3">
          <div className="min-w-0 flex-1">
            {!compact && <h1 className="text-xl font-bold tracking-tight">{reorderMode ? 'Reorder Agents' : 'Chats'}</h1>}
            {compact && <span className="font-semibold text-[15px] block truncate">{reorderMode ? 'Reorder' : 'Chats'}</span>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!reorderMode && (
              <>
                <motion.button whileTap={{ scale: 0.9 }} onClick={toggleViewMode}
                  className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-text/35 dark:text-text-inv/30 hover:text-primary transition-colors"
                  title={viewMode === 'list' ? 'Grid view' : 'List view'}>
                  {viewMode === 'list' ? <LayoutGrid size={18} /> : <List size={18} />}
                </motion.button>
                <motion.button whileTap={{ scale: 0.9 }} onClick={handleRefresh}
                  className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-text/40 dark:text-text-inv/40 hover:text-primary transition-colors">
                  <RefreshCw size={16} className={Object.values(refreshingMap).some(Boolean) ? 'animate-spin' : ''} />
                </motion.button>
              </>
            )}
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setReorderMode(m => !m)}
              className={cn('p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md transition-colors', reorderMode ? 'text-white bg-primary' : 'text-text/35 dark:text-text-inv/30 hover:text-primary')}
              title={reorderMode ? 'Done' : 'Reorder agents'}>
              {reorderMode ? <Check size={16} /> : <ArrowUpDown size={16} />}
            </motion.button>
            {!reorderMode && (
              <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                connectedCount > 0 ? 'text-primary/70 bg-primary/8' : 'text-text/50 dark:text-text-inv/40 bg-text/5 dark:bg-text-inv/5')}>
                {connectedCount}/{connections.length}
              </span>
            )}
          </div>
        </div>

        {/* Search — hidden in reorder mode */}
        {!reorderMode && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text/50 dark:text-text-inv/45" size={compact ? 14 : 16} />
            <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); (e.target as HTMLInputElement).blur(); } }} placeholder="Search agents…"
              className={cn('pl-9 rounded-lg bg-text/[0.04] dark:bg-text-inv/[0.04] border-0 placeholder:text-text/30 dark:placeholder:text-text-inv/25',
                compact ? 'h-8 py-0 text-[12px] pl-8' : 'h-10 py-0 text-[14px]')} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className={cn('flex-1 min-h-0 overflow-y-auto', compact ? 'px-1 pb-2' : 'px-2 pb-4')}>
        {/* Reorder mode hint */}
        {reorderMode && (
          <p className="text-center text-[12px] text-text/40 dark:text-text-inv/35 py-2 mb-1">
            Drag to reorder • Tap <Check size={10} className="inline" /> when done
          </p>
        )}

        {searchQuery.trim() && !reorderMode ? (
          <div className={viewMode === 'grid' ? 'grid gap-2 auto-fill-grid px-1' : 'space-y-0.5'}>
            {filteredResults.length > 0 ? filteredResults.map(({ agent, connection }, i) => (
              viewMode === 'grid' ? renderGridCard(connection, agent, i) : renderListCard(connection, agent, i, true)
            )) : (
              <div className={cn('text-center text-text/50 dark:text-text-inv/45 text-[13px]', viewMode === 'grid' ? 'col-span-full mt-10' : 'mt-10')}>No matching agents found</div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Global Favorites section */}
            {favoriteAgents.length > 0 && !reorderMode && (
              <div>
                <div className="flex items-center gap-2 px-3 py-2">
                  <Star size={12} className="text-amber-500 fill-amber-500 shrink-0" />
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-amber-600/70 dark:text-amber-400/70 truncate flex-1">
                    Favorites
                  </span>
                </div>
                <div className={viewMode === 'grid' ? 'grid gap-2 auto-fill-grid px-1 pb-1' : 'space-y-0.5 pb-1'}>
                  {favoriteAgents.map(({ agent, connection }, i) => (
                    viewMode === 'grid'
                      ? renderGridCard(connection, agent, i)
                      : renderListCard(connection, agent, i)
                  ))}
                </div>
              </div>
            )}

            {/* Connection groups / single connection */}
            {showGroupedView ? (
              connections.map(connection => {
                const isExpanded = expandedIds.includes(connection.id);
                const status = statusMap[connection.id] || 'disconnected';
                const isDisconnected = status === 'disconnected';

                return (
                  <div key={connection.id} className={cn(isDisconnected && 'opacity-75')}>
                    <button type="button" onClick={() => handleToggleGroup(connection.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left group">
                      <span className={cn('inline-flex h-2 w-2 rounded-full shrink-0', getStatusClasses(status))} />
                      <span className="sr-only">{status === 'connected' ? 'Connected' : status === 'connecting' || status === 'reconnecting' ? 'Connecting' : 'Disconnected'}</span>
                      <span className={cn('text-[12px] font-semibold uppercase tracking-wider truncate flex-1',
                        isDisconnected ? 'text-text/35 dark:text-text-inv/30' : 'text-text/50 dark:text-text-inv/45')}>
                        {getConnectionLabel(connection)}
                        {isDisconnected && <span className="normal-case tracking-normal font-medium ml-1.5 text-text/30 dark:text-text-inv/25">· Disconnected</span>}
                      </span>
                      <ChevronDown size={12} className={cn('shrink-0 text-text/25 dark:text-text-inv/35 transition-transform duration-200', isExpanded && 'rotate-180')} />
                    </button>
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                          {renderAgentList(connection.id, connection)}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })
            ) : (
              renderAgentList(connections[0].id, connections[0])
            )}
          </div>
        )}

        {/* Add server button — hidden in reorder mode */}
        {!reorderMode && (
          <button onClick={onAddServer}
            className={cn('w-full mt-3 py-2.5 flex items-center justify-center gap-1.5',
              'text-[13px] font-medium text-text/35 dark:text-text-inv/30',
              'rounded-lg border border-dashed border-text/10 dark:border-text-inv/10',
              'hover:border-text/20 dark:hover:border-text-inv/15 hover:text-text/50 dark:hover:text-text-inv/40',
              'transition-colors')}>
            <Plus size={13} /> Add Server
          </button>
        )}
      </div>

      {/* Avatar context menu */}
      {avatarMenuAgent && (
        <div className="fixed z-50 bg-white dark:bg-card-alt rounded-lg shadow-lg border border-border/60 dark:border-border-dark/60 py-1 min-w-[140px]"
          style={{ left: avatarMenuAgent.x, top: avatarMenuAgent.y }} onClick={e => e.stopPropagation()}>
          <button className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-text/[0.04] dark:hover:bg-text-inv/[0.04] transition-colors"
            onClick={() => handleSetCustomAvatar(avatarMenuAgent.connectionId, avatarMenuAgent.agentId)}>
            {customAvatars[`${avatarMenuAgent.connectionId}:${avatarMenuAgent.agentId}`] ? 'Change avatar' : 'Set custom avatar'}
          </button>
          {customAvatars[`${avatarMenuAgent.connectionId}:${avatarMenuAgent.agentId}`] && (
            <button className="w-full text-left px-3 py-1.5 text-[12px] text-red-500 hover:bg-text/[0.04] dark:hover:bg-text-inv/[0.04] transition-colors"
              onClick={() => handleRemoveCustomAvatar(avatarMenuAgent.connectionId, avatarMenuAgent.agentId)}>
              Remove avatar
            </button>
          )}
        </div>
      )}

      {/* Avatar upload dialog */}
      <AvatarUploader open={!!avatarUploadAgent} onClose={() => setAvatarUploadAgent(null)}
        onSave={handleAvatarSave} currentAvatar={avatarUploadAgent ? customAvatars[avatarUploadAgent] : undefined} />
    </div>
  );
}
