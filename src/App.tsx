import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useLogto } from '@logto/react';
import Onboarding from './screens/Onboarding';
import Callback from './screens/Callback';
import ChatList from './screens/ChatList';
import BottomNav from './components/BottomNav';
import UpdateBanner from './components/UpdateBanner';
import IOSInstallPrompt from './components/IOSInstallPrompt';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useNavigationStore, type Screen, type SplitPane } from './stores/navigationStore';

const SIDEBAR_WIDTH_KEY = 'openclaw.sidebar.width';
const SPLIT_STATE_KEY = 'openclaw.split.enabled';
const SPLIT_PANES_KEY = 'clawline.split.panes';
const MIN_SIDEBAR = 240;
const MAX_SIDEBAR = 600;
const DEFAULT_SIDEBAR = 288; // w-72
const EMPTY_SPLIT_VALUE = '__empty__';

import { getActiveConnectionId, getConnectionById, setActiveConnectionId } from './services/connectionStore';
import { MESSAGE_PREVIEW_UPDATED_EVENT } from './components/chat/utils';
import { useSwipeBack } from './hooks/useSwipeBack';
import { usePWAUpdate } from './hooks/usePWAUpdate';
import { useIOSPWA } from './hooks/useIOSPWA';
import { cn } from './lib/utils';
import { MessageCircle, LayoutDashboard, Search as SearchIcon, User, Inbox as InboxIcon } from 'lucide-react';
import { migrateFromLocalStorage } from './services/messageDB';
import { initInbox, getUnreadTotal, onInboxUpdate } from './services/agentInbox';

// Lazy-loaded heavy screens
const ChatRoom = lazy(() => import('./screens/ChatRoom'));
const Dashboard = lazy(() => import('./screens/Dashboard'));
const Profile = lazy(() => import('./screens/Profile'));
const Search = lazy(() => import('./screens/Search'));
const Preferences = lazy(() => import('./screens/Preferences'));
const Pairing = lazy(() => import('./screens/Pairing'));
const AgentInbox = lazy(() => import('./screens/AgentInbox'));

export type { Screen } from './stores/navigationStore';

function ScreenLoading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

const STORAGE_KEY_USER_ID = 'openclaw.userId';
const STORAGE_KEY_USER_NAME = 'openclaw.userName';
const INDEXED_DB_MIGRATED_KEY = 'openclaw.indexeddb.migrated';


function createUserId() {
  return `web-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getUserId(): string {
  let id = localStorage.getItem(STORAGE_KEY_USER_ID);
  if (!id) {
    id = createUserId();
    localStorage.setItem(STORAGE_KEY_USER_ID, id);
  }
  return id;
}

export function getUserName(): string {
  return localStorage.getItem(STORAGE_KEY_USER_NAME) || 'OpenClaw User';
}

export function setUserName(name: string) {
  localStorage.setItem(STORAGE_KEY_USER_NAME, name);
}

/* ---- URL ⇄ Screen 同步层 ---- */

const SCREEN_TO_PATH: Record<Screen, string> = {
  onboarding: '/',
  callback: '/callback',
  chats: '/chats',
  chat_room: '/chat',  // + /:agentId?chatId=...
  dashboard: '/dashboard',
  inbox: '/inbox',
  profile: '/profile',
  search: '/search',
  preferences: '/preferences',
  pairing: '/pairing',
};

function pathToScreen(pathname: string, search: string): { screen: Screen; agentId?: string; chatId?: string; connectionId?: string } {
  if (pathname.startsWith('/chat/')) {
    const params = new URLSearchParams(search);
    return {
      screen: 'chat_room',
      agentId: decodeURIComponent(pathname.slice('/chat/'.length)),
      chatId: params.get('chatId') || undefined,
      connectionId: params.get('connectionId') || undefined,
    };
  }
  for (const [screen, path] of Object.entries(SCREEN_TO_PATH)) {
    if (pathname === path) return { screen: screen as Screen };
  }
  return { screen: 'onboarding' };
}

function useIsDesktop() {
  // Check URL param for forced layout mode (dev testing)
  const forcedMobile = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('mobile') === 'true' ||
    new URLSearchParams(window.location.search).get('layout') === 'mobile'
  );
  
  const [isDesktop, setIsDesktop] = useState(() => {
    if (forcedMobile) return false;
    return typeof window !== 'undefined' && window.innerWidth >= 1024;
  });
  
  useEffect(() => {
    if (forcedMobile) return; // Skip listener if forced
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [forcedMobile]);
  return isDesktop;
}

function useIsSplitViewport() {
  const forcedMobile = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('mobile') === 'true' ||
    new URLSearchParams(window.location.search).get('layout') === 'mobile'
  );

  const [isSplitViewport, setIsSplitViewport] = useState(() => {
    if (forcedMobile) return false;
    return typeof window !== 'undefined' && window.innerWidth >= 1440;
  });

  useEffect(() => {
    if (forcedMobile) return;
    const mql = window.matchMedia('(min-width: 1440px)');
    const handler = (event: MediaQueryListEvent) => setIsSplitViewport(event.matches);
    setIsSplitViewport(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [forcedMobile]);

  return isSplitViewport;
}

const SIDEBAR_NAV_ITEMS = [
  { id: 'chats', icon: MessageCircle, label: 'Chats' },
  { id: 'inbox', icon: InboxIcon, label: 'Inbox' },
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'search', icon: SearchIcon, label: 'Search' },
  { id: 'profile', icon: User, label: 'Profile' },
] as const;

function AppShell() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading } = useLogto();

  const effectivelyAuthenticated = isAuthenticated;

  // ── All hooks MUST be called before any conditional return ──
  // (React Rules of Hooks — Error #310 fix)

  const initialFromUrl = pathToScreen(location.pathname, location.search);
  const initialScreen: Screen = effectivelyAuthenticated ? (initialFromUrl.screen === 'onboarding' && location.pathname === '/' ? 'chats' : initialFromUrl.screen) : 'onboarding';

  // Navigation state from Zustand store
  const currentScreen = useNavigationStore((s) => s.currentScreen);
  const setCurrentScreen = useNavigationStore((s) => s.setCurrentScreen);
  const activeAgentId = useNavigationStore((s) => s.activeAgentId);
  const setActiveAgentId = useNavigationStore((s) => s.setActiveAgentId);
  const activeChatId = useNavigationStore((s) => s.activeChatId);
  const setActiveChatId = useNavigationStore((s) => s.setActiveChatId);
  const activeConnectionId = useNavigationStore((s) => s.activeConnectionId);
  const setActiveConnectionState = useNavigationStore((s) => s.setActiveConnectionId);
  const splitPanes = useNavigationStore((s) => s.splitPanes);
  const setSplitPanes = useNavigationStore((s) => s.setSplitPanes);

  // Initialize screen from URL on first render
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    setCurrentScreen(initialScreen);
    if (initialFromUrl.agentId) setActiveAgentId(initialFromUrl.agentId);
    if (initialFromUrl.chatId) setActiveChatId(initialFromUrl.chatId);
    setActiveConnectionState(initialFromUrl.connectionId ?? getActiveConnectionId());
  }, []);

  // Unread message badge for BottomNav
  const [unreadChats, setUnreadChats] = useState(0);
  const [inboxBadge, setInboxBadge] = useState(() => getUnreadTotal());
  const unreadAgentsRef = useRef(new Set<string>());
  const currentScreenRef = useRef(currentScreen);
  currentScreenRef.current = currentScreen;

  useEffect(() => {
    const refresh = () => setInboxBadge(getUnreadTotal());
    const unsub = onInboxUpdate(refresh);
    return unsub;
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      if (currentScreenRef.current !== 'chats' && currentScreenRef.current !== 'chat_room') {
        const detail = (e as CustomEvent).detail;
        if (detail?.connectionId && detail?.agentId) {
          unreadAgentsRef.current.add(`${detail.connectionId}:${detail.agentId}`);
          setUnreadChats(unreadAgentsRef.current.size);
        }
      }
    };
    window.addEventListener(MESSAGE_PREVIEW_UPDATED_EVENT, handler);
    return () => window.removeEventListener(MESSAGE_PREVIEW_UPDATED_EVENT, handler);
  }, []);

  // Clear unread when user navigates to chats
  useEffect(() => {
    if (currentScreen === 'chats' || currentScreen === 'chat_room') {
      unreadAgentsRef.current.clear();
      setUnreadChats(0);
    }
  }, [currentScreen]);

  // PWA update detection
  const { updateAvailable, applyUpdate, dismissUpdate } = usePWAUpdate();

  // iOS PWA optimizations
  const { showInstallPrompt } = useIOSPWA();

  // Sidebar resize (desktop)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { const w = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || ''); return w >= MIN_SIDEBAR && w <= MAX_SIDEBAR ? w : DEFAULT_SIDEBAR; } catch { return DEFAULT_SIDEBAR; }
  });
  const sidebarResizing = useRef(false);
  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarResizing.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!sidebarResizing.current) return;
      const newW = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startW + ev.clientX - startX));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      sidebarResizing.current = false;
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); } catch { /* noop */ }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  // URL → Screen（浏览器前进/后退）
  useEffect(() => {
    const { screen, agentId, chatId, connectionId } = pathToScreen(location.pathname, location.search);
    setCurrentScreen(screen);
    // Only update agent/chat state when URL explicitly contains them (chat_room route).
    // For other routes (inbox, dashboard, etc.), preserve existing agent state
    // so the desktop main panel keeps the chat visible.
    if (screen === 'chat_room' || agentId) {
      setActiveAgentId(agentId ?? null);
      setActiveChatId(chatId ?? null);
      const nextConnectionId = connectionId ?? getActiveConnectionId();
      setActiveConnectionState(nextConnectionId);
      if (connectionId && connectionId !== getActiveConnectionId() && getConnectionById(connectionId)) {
        setActiveConnectionId(connectionId);
      }
    }
  }, [location.pathname, location.search]);

  const navigate = useCallback((screen: Screen, agentId?: string, chatId?: string, connectionId?: string) => {
    setCurrentScreen(screen);
    // Only update agent/chat state when explicitly navigating to chat_room,
    // or when values are provided. Preserve existing values for tab switches
    // (inbox, dashboard, etc.) so the chat is still there when user comes back.
    if (screen === 'chat_room' || agentId !== undefined) {
      setActiveAgentId(agentId ?? null);
      setActiveChatId(chatId ?? null);
      setActiveConnectionState(connectionId ?? getActiveConnectionId());
    }

    // Screen → URL
    if (screen === 'chat_room' && agentId) {
      const params = new URLSearchParams();
      if (chatId) params.set('chatId', chatId);
      if (connectionId) {
        params.set('connectionId', connectionId);
        if (getConnectionById(connectionId)) {
          setActiveConnectionId(connectionId);
        }
      }
      routerNavigate({
        pathname: `/chat/${encodeURIComponent(agentId)}`,
        search: params.toString() ? `?${params.toString()}` : '',
      });
    } else {
      routerNavigate(SCREEN_TO_PATH[screen]);
    }
  }, [routerNavigate]);

  // Handle swipe-back gesture — use SPA navigate() instead of window.history.back()
  // to avoid full page reloads that kill WebSocket connections
  const handleSwipeBack = useCallback(() => {
    if (currentScreen === 'chat_room') {
      navigate('chats');
    } else if (currentScreen === 'preferences') {
      navigate('profile');
    } else if (currentScreen === 'pairing') {
      navigate('profile');
    } else {
      navigate('chats');
    }
  }, [currentScreen, navigate]);

  // Determine if swipe-back should be enabled
  const canGoBack = ['chat_room', 'preferences', 'pairing'].includes(currentScreen);

  // Use swipe-back hook for iOS-style gestures
  const { dragX, dragProgress } = useSwipeBack({
    onSwipeBack: handleSwipeBack,
    threshold: 100,
    enabled: canGoBack,
  });

  const isDesktop = useIsDesktop();
  const isSplitViewport = useIsSplitViewport();
  const MAX_SPLIT_PANES = 5; // + main = 6 panes total
  const splitOpen = (currentScreen === 'chat_room' || (currentScreen === 'chats' && !!activeAgentId)) && isSplitViewport && splitPanes.length > 0;
  const splitAnyAwaiting = splitOpen && splitPanes.some((p) => p.agentId === EMPTY_SPLIT_VALUE);

  const closeSplitView = useCallback(() => {
    setSplitPanes([]);
    try { localStorage.setItem(SPLIT_STATE_KEY, 'off'); localStorage.removeItem(SPLIT_PANES_KEY); } catch { /* noop */ }
  }, []);

  const closeSplitPane = useCallback((index: number) => {
    setSplitPanes((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        try { localStorage.setItem(SPLIT_STATE_KEY, 'off'); localStorage.removeItem(SPLIT_PANES_KEY); } catch { /* noop */ }
      }
      return next;
    });
  }, []);

  const openSplitChat = useCallback((connectionId: string, agentId: string, chatId?: string) => {
    if (!isSplitViewport) return;
    setSplitPanes((prev) => {
      // Fill the first empty pane, or append
      const emptyIdx = prev.findIndex((p) => p.agentId === EMPTY_SPLIT_VALUE);
      if (emptyIdx >= 0) {
        const next = [...prev];
        next[emptyIdx] = { connectionId, agentId, chatId: chatId ?? null };
        return next;
      }
      if (prev.length >= MAX_SPLIT_PANES) return prev;
      return [...prev, { connectionId, agentId, chatId: chatId ?? null }];
    });
  }, [isSplitViewport]);

  const toggleSplitView = useCallback(() => {
    if (!isSplitViewport) return;
    if (splitPanes.length >= MAX_SPLIT_PANES) {
      // All slots full, close all
      closeSplitView();
      return;
    }
    // Add an empty split pane
    try { localStorage.removeItem(SPLIT_STATE_KEY); } catch { /* noop */ }
    setSplitPanes((prev) => [
      ...prev,
      { connectionId: EMPTY_SPLIT_VALUE, agentId: EMPTY_SPLIT_VALUE, chatId: null },
    ]);
  }, [closeSplitView, isSplitViewport, splitPanes.length]);

  // Zustand persist handles splitPanes localStorage sync automatically

  const splitPanesClearedRef = useRef(false);
  useEffect(() => {
    // Skip first render — allow restored panes to survive initial mount
    if (!splitPanesClearedRef.current) {
      splitPanesClearedRef.current = true;
      return;
    }
    // Only clear panes when viewport becomes too small for split
    // Screen navigation should NOT clear panes (they'll restore when back in chat_room)
    if (!isSplitViewport) {
      setSplitPanes([]);
    }
  }, [isSplitViewport]);

  // ── Conditional returns AFTER all hooks ──

  // Handle /callback route
  if (location.pathname === '/callback') {
    return <Callback />;
  }

  // Show loading while Logto initializes (skip in dev mode)
  if (isAuthLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-surface dark:bg-surface-dark text-text dark:text-text-inv">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const renderScreen = () => {
    // Redirect unauthenticated users to onboarding (except callback)
    if (!effectivelyAuthenticated && currentScreen !== 'onboarding' && currentScreen !== 'callback') {
      return <Onboarding onGetStarted={() => navigate('chats')} />;
    }
    const content = (() => {
      switch (currentScreen) {
        case 'onboarding':
          return <Onboarding onGetStarted={() => navigate('chats')} />;
        case 'callback':
          return <Callback />;
        case 'chats':
          return <ChatList onOpenChat={(connectionId, agentId, chatId) => navigate('chat_room', agentId, chatId, connectionId)} onAddServer={() => navigate('pairing')} activeAgentId={activeAgentId} activeConnectionId={activeConnectionId} />;
        case 'chat_room':
          return <ChatRoom agentId={activeAgentId} chatId={activeChatId} connectionId={activeConnectionId} onBack={() => navigate('chats')} onOpenConversation={(nextChatId) => navigate('chat_room', activeAgentId || undefined, nextChatId, activeConnectionId || undefined)} />;
        case 'dashboard':
          return <Dashboard />;
        case 'inbox':
          return <AgentInbox />;
        case 'profile':
          return <Profile onNavigate={navigate} />;
        case 'search':
          return <Search />;
        case 'preferences':
          return <Preferences onBack={() => navigate('profile')} />;
        case 'pairing':
          return <Pairing onBack={() => navigate('profile')} onPaired={(connId) => { setActiveConnectionId(connId); setActiveConnectionState(connId); navigate('chats'); }} />;
        default:
          return <Onboarding onGetStarted={() => navigate('chats')} />;
      }
    })();
    return <Suspense fallback={<ScreenLoading />}>{content}</Suspense>;
  };

  // Persistent chat panel — survives tab switches via CSS display:none
  const renderChatPanel = () => {
    const renderSplitPane = (pane: SplitPane, idx: number) => {
      const paneHasAgent = pane.agentId !== EMPTY_SPLIT_VALUE && pane.connectionId !== EMPTY_SPLIT_VALUE;
      const runtimeConnId = paneHasAgent
        ? `${pane.connectionId}::split${idx}::${pane.agentId}`
        : null;

      if (paneHasAgent && runtimeConnId) {
        return (
          <ChatRoom
            key={`split-${pane.connectionId}-${pane.agentId}`}
            agentId={pane.agentId}
            chatId={pane.chatId}
            connectionId={pane.connectionId}
            channelConnectionId={runtimeConnId}
            onBack={() => {}}
            onOpenConversation={(nextChatId) => {
              setSplitPanes((prev) => {
                const next = [...prev];
                next[idx] = { ...next[idx], chatId: nextChatId };
                return next;
              });
            }}
            isDesktop
            isSplitPane
            onCloseSplit={() => closeSplitPane(idx)}
          />
        );
      }
      return (
        <div key={`split-empty-${idx}`} className="flex-1 overflow-hidden flex items-center justify-center">
          <div className="text-center px-8">
            <div className="w-14 h-14 rounded-2xl bg-primary/8 flex items-center justify-center mb-4 mx-auto">
              <MessageCircle size={24} className="text-primary/60" />
            </div>
            <p className="text-[14px] text-text/35 dark:text-text-inv/30">Select an agent from the sidebar</p>
            <button onClick={() => closeSplitPane(idx)} className="mt-3 text-xs text-text/40 hover:text-text/60 dark:text-text-inv/40 dark:hover:text-text-inv/60">Close pane</button>
          </div>
        </div>
      );
    };

    if (splitOpen) {
      return (
        <Suspense fallback={<ScreenLoading />}>
          <div className="flex h-full min-w-0 bg-surface dark:bg-surface-dark divide-x divide-border/40 dark:divide-border-dark/40">
            <div className="min-w-[320px] flex-1 overflow-hidden">
              <ChatRoom
                agentId={activeAgentId}
                chatId={activeChatId}
                connectionId={activeConnectionId}
                onBack={() => navigate('chats')}
                onOpenConversation={(nextChatId) => navigate('chat_room', activeAgentId || undefined, nextChatId, activeConnectionId || undefined)}
                isDesktop
                showSplitButton={isSplitViewport}
                splitActive={splitOpen}
                onToggleSplit={toggleSplitView}
              />
            </div>
            {splitPanes.map((pane, idx) => (
              <div key={`pane-${pane.connectionId}-${pane.agentId}`} className="min-w-[320px] flex-1 overflow-hidden">
                {renderSplitPane(pane, idx)}
              </div>
            ))}
          </div>
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<ScreenLoading />}>
        <ChatRoom
          agentId={activeAgentId}
          chatId={activeChatId}
          connectionId={activeConnectionId}
          onBack={() => { setActiveAgentId(null); setActiveChatId(null); }}
          onOpenConversation={(nextChatId) => navigate('chat_room', activeAgentId || undefined, nextChatId, activeConnectionId || undefined)}
          isDesktop
          showSplitButton={isSplitViewport}
          splitActive={splitOpen}
          onToggleSplit={toggleSplitView}
        />
      </Suspense>
    );
  };

  // Non-chat screens — Dashboard, Inbox, Profile, etc.
  const renderNonChatDesktopMain = () => {
    const content = (() => {
      switch (currentScreen) {
        case 'dashboard':
          return <Dashboard />;
        case 'inbox':
          return <AgentInbox />;
        case 'profile':
          return <Profile onNavigate={navigate} />;
        case 'search':
          return <Search />;
        case 'preferences':
          return <Preferences onBack={() => navigate('profile')} />;
        case 'pairing':
          return <Pairing onBack={() => navigate('profile')} onPaired={(connId) => { setActiveConnectionId(connId); setActiveConnectionState(connId); navigate('chats'); }} />;
        case 'onboarding':
          return <Onboarding onGetStarted={() => navigate('chats')} />;
        default:
          return (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-14 h-14 rounded-2xl bg-primary/8 flex items-center justify-center mb-4">
                <MessageCircle size={24} className="text-primary/60" />
              </div>
              <p className="text-[14px] text-text/35 dark:text-text-inv/30">Select an agent to start chatting</p>
            </div>
          );
      }
    })();
    return <Suspense fallback={<ScreenLoading />}>{content}</Suspense>;
  };

  const showBottomNav = ['chats', 'dashboard', 'inbox', 'profile', 'search'].includes(currentScreen);

  // ---- Desktop layout: sidebar + main ----
  // Onboarding gets a special full-width desktop layout without sidebar
  if (isDesktop && currentScreen === 'onboarding') {
    return (
      <div className="w-full h-full bg-surface dark:bg-surface-dark text-text dark:text-text-inv font-sans overflow-hidden">
        <Onboarding onGetStarted={() => navigate('chats')} />
      </div>
    );
  }

  if (isDesktop) {
    return (
      <div className="flex flex-col w-full h-full bg-surface dark:bg-surface-dark text-text dark:text-text-inv overflow-hidden font-sans">
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar */}
        <div style={{ width: sidebarWidth }} className="sidebar-surface flex-shrink-0 flex flex-col relative min-h-0 overflow-hidden">
          {/* Sidebar content: ChatList */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <ChatList
              onOpenChat={(connectionId, agentId, chatId) => navigate('chat_room', agentId, chatId, connectionId)}
              onOpenSplitChat={openSplitChat}
              onAddServer={() => navigate('pairing')}
              compact
              activeAgentId={activeAgentId}
              activeConnectionId={activeConnectionId}
              splitEnabled={isSplitViewport && currentScreen === 'chat_room'}
              splitAwaitingAgent={splitAnyAwaiting}
              splitPanes={splitPanes}
            />
          </div>

          {/* Sidebar nav — bottom */}
          <div className="flex items-center gap-1 px-2 py-2 min-h-[52px] shadow-[inset_0_1px_0_rgba(148,163,184,0.14)] dark:shadow-[inset_0_1px_0_rgba(71,85,105,0.36)]">
            {SIDEBAR_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === 'chats'
                ? (currentScreen === 'chats' || currentScreen === 'chat_room')
                : currentScreen === item.id;
              const badge = item.id === 'inbox' ? inboxBadge : 0;
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.id as Screen)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-medium transition-all relative',
                    isActive
                      ? 'bg-primary text-white shadow-[0_12px_24px_-18px_rgba(239,90,35,0.95)]'
                      : 'bg-white/68 text-text/55 shadow-sm hover:bg-white hover:text-text dark:bg-white/[0.06] dark:text-text-inv/55 dark:hover:bg-white/[0.1] dark:hover:text-text-inv'
                  )}
                >
                  <div className="relative">
                    <Icon size={15} />
                    {badge > 0 && !isActive && (
                      <span className="absolute -top-1.5 -right-2 min-w-[14px] h-3.5 flex items-center justify-center rounded-full bg-primary text-white text-[8px] font-bold px-0.5 shadow-sm">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </div>
                  <span className="hidden xl:inline">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Resize handle */}
          <div
            onMouseDown={handleSidebarMouseDown}
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-20"
          />
        </div>

        {/* Main content */}
        <div className="main-panel-surface flex-1 h-full relative overflow-hidden">
          <UpdateBanner isVisible={updateAvailable} onUpdate={applyUpdate} onDismiss={dismissUpdate} />

          {/* Persistent chat layer — always mounted when active agent exists, hidden via CSS */}
          {activeAgentId && (
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ display: currentScreen === 'chat_room' || currentScreen === 'chats' ? 'block' : 'none' }}
            >
              {renderChatPanel()}
            </div>
          )}

          {/* Non-chat screens — animated transitions */}
          {currentScreen !== 'chat_room' && !(currentScreen === 'chats' && activeAgentId) && (
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={currentScreen}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 overflow-y-auto"
              >
                {renderNonChatDesktopMain()}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        </div>
      </div>
    );
  }

  // ---- Mobile layout (unchanged) ----

  return (
    <div className="relative w-full h-full pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-surface dark:bg-surface-dark text-text dark:text-text-inv overflow-hidden flex flex-col font-sans">
      <div className="flex-1 flex justify-center relative min-h-0">
        <div className="w-full max-w-md md:max-w-lg h-full relative bg-surface dark:bg-surface-dark overflow-hidden">
        {/* PWA Update Banner */}
        <UpdateBanner
          isVisible={updateAvailable}
          onUpdate={applyUpdate}
          onDismiss={dismissUpdate}
        />

        {/* iOS Install Prompt */}
        <IOSInstallPrompt show={showInstallPrompt} />

        <AnimatePresence mode="popLayout" initial={false}>
          {/* Outer motion.div: handles screen enter/exit transitions only */}
          <motion.div
            key={currentScreen}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={`absolute inset-0 ${currentScreen === 'chat_room' || currentScreen === 'onboarding' ? 'overflow-hidden' : 'overflow-y-auto'}`}
          >
            {/* Inner motion.div: handles swipe-back drag (decoupled from transitions) */}
            <motion.div
              style={{ x: dragX }}
              className={currentScreen === 'chat_room' || currentScreen === 'onboarding' ? 'h-full' : undefined}
            >
              {renderScreen()}
            </motion.div>
          </motion.div>
        </AnimatePresence>

        {showBottomNav && (
          <BottomNav currentScreen={currentScreen} onNavigate={navigate} unreadChats={unreadChats} />
        )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    if (localStorage.getItem(INDEXED_DB_MIGRATED_KEY) === '1') {
      return;
    }

    let cancelled = false;

    void migrateFromLocalStorage().then(() => {
      if (cancelled) return;
      localStorage.setItem(INDEXED_DB_MIGRATED_KEY, '1');
    }).catch(() => {
      // Retry on next app launch if migration fails.
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize the agent inbox service on app mount
  useEffect(() => {
    void initInbox();
  }, []);

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
