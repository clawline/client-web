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

const SIDEBAR_WIDTH_KEY = 'openclaw.sidebar.width';
const MIN_SIDEBAR = 240;
const MAX_SIDEBAR = 600;
const DEFAULT_SIDEBAR = 288; // w-72
import { getActiveConnectionId, getConnectionById, setActiveConnectionId } from './services/connectionStore';
import { useSwipeBack } from './hooks/useSwipeBack';
import { usePWAUpdate } from './hooks/usePWAUpdate';
import { useIOSPWA } from './hooks/useIOSPWA';
import { cn } from './lib/utils';
import { MessageCircle, LayoutDashboard, Search as SearchIcon, User } from 'lucide-react';
import { migrateFromLocalStorage } from './services/messageDB';

// Lazy-loaded heavy screens
const ChatRoom = lazy(() => import('./screens/ChatRoom'));
const Dashboard = lazy(() => import('./screens/Dashboard'));
const Profile = lazy(() => import('./screens/Profile'));
const Search = lazy(() => import('./screens/Search'));
const Preferences = lazy(() => import('./screens/Preferences'));
const Pairing = lazy(() => import('./screens/Pairing'));

export type Screen = 'onboarding' | 'callback' | 'chats' | 'chat_room' | 'dashboard' | 'profile' | 'search' | 'preferences' | 'pairing';

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

  const [currentScreen, setCurrentScreen] = useState<Screen>(initialScreen);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(initialFromUrl.agentId ?? null);
  const [activeChatId, setActiveChatId] = useState<string | null>(initialFromUrl.chatId ?? null);
  const [activeConnectionId, setActiveConnectionState] = useState<string | null>(initialFromUrl.connectionId ?? getActiveConnectionId());
  const [splitAgentId, setSplitAgentId] = useState<string | null>(null);
  const [splitChatId, setSplitChatId] = useState<string | null>(null);
  const [splitConnectionId, setSplitConnectionId] = useState<string | null>(null);

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
    setActiveAgentId(agentId ?? null);
    setActiveChatId(chatId ?? null);
    const nextConnectionId = connectionId ?? getActiveConnectionId();
    setActiveConnectionState(nextConnectionId);
    if (connectionId && connectionId !== getActiveConnectionId() && getConnectionById(connectionId)) {
      setActiveConnectionId(connectionId);
    }
  }, [location.pathname, location.search]);

  const navigate = useCallback((screen: Screen, agentId?: string, chatId?: string, connectionId?: string) => {
    setCurrentScreen(screen);
    setActiveAgentId(agentId ?? null);
    setActiveChatId(chatId ?? null);
    setActiveConnectionState(connectionId ?? getActiveConnectionId());

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

  // Handle swipe-back gesture
  const handleSwipeBack = useCallback(() => {
    // Use browser history to go back
    window.history.back();
  }, []);

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
  const splitActive = currentScreen === 'chat_room' && isSplitViewport && !!splitAgentId && !!splitConnectionId;
  const splitRuntimeConnectionId = splitActive && splitConnectionId && splitAgentId
    ? `${splitConnectionId}::split::${splitAgentId}`
    : null;

  const closeSplitView = useCallback(() => {
    setSplitAgentId(null);
    setSplitChatId(null);
    setSplitConnectionId(null);
  }, []);

  const openSplitChat = useCallback((connectionId: string, agentId: string, chatId?: string) => {
    if (!isSplitViewport) return;
    setSplitConnectionId(connectionId);
    setSplitAgentId(agentId);
    setSplitChatId(chatId ?? null);
  }, [isSplitViewport]);

  const toggleSplitView = useCallback(() => {
    if (!isSplitViewport || !activeConnectionId || !activeAgentId) {
      return;
    }

    if (splitActive) {
      closeSplitView();
      return;
    }

    setSplitConnectionId(activeConnectionId);
    setSplitAgentId(activeAgentId);
    setSplitChatId(activeChatId);
  }, [activeAgentId, activeChatId, activeConnectionId, closeSplitView, isSplitViewport, splitActive]);

  useEffect(() => {
    if (!isSplitViewport || currentScreen !== 'chat_room') {
      closeSplitView();
    }
  }, [closeSplitView, currentScreen, isSplitViewport]);

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

  // For desktop: which screen to show in the main panel (not chat list, since it's in sidebar)
  const renderDesktopMain = () => {
    const content = (() => {
      switch (currentScreen) {
        case 'chat_room':
          if (splitActive && splitConnectionId && splitAgentId && splitRuntimeConnectionId) {
            return (
              <div className="flex h-full min-w-0 bg-surface dark:bg-surface-dark">
                <div className="min-w-[400px] flex-1 overflow-hidden border-r border-border/60 dark:border-border-dark/60">
                  <ChatRoom
                    agentId={activeAgentId}
                    chatId={activeChatId}
                    connectionId={activeConnectionId}
                    onBack={() => navigate('chats')}
                    onOpenConversation={(nextChatId) => navigate('chat_room', activeAgentId || undefined, nextChatId, activeConnectionId || undefined)}
                    isDesktop
                    showSplitButton={isSplitViewport}
                    splitActive={splitActive}
                    onToggleSplit={toggleSplitView}
                  />
                </div>
                <div className="min-w-[400px] flex-1 overflow-hidden">
                  <ChatRoom
                    agentId={splitAgentId}
                    chatId={splitChatId}
                    connectionId={splitConnectionId}
                    channelConnectionId={splitRuntimeConnectionId}
                    onBack={() => {}}
                    onOpenConversation={(nextChatId) => setSplitChatId(nextChatId)}
                    isDesktop
                    isSplitPane
                    onCloseSplit={closeSplitView}
                  />
                </div>
              </div>
            );
          }

          return (
            <ChatRoom
              agentId={activeAgentId}
              chatId={activeChatId}
              connectionId={activeConnectionId}
              onBack={() => navigate('chats')}
              onOpenConversation={(nextChatId) => navigate('chat_room', activeAgentId || undefined, nextChatId, activeConnectionId || undefined)}
              isDesktop
              showSplitButton={isSplitViewport}
              splitActive={splitActive}
              onToggleSplit={toggleSplitView}
            />
          );
        case 'dashboard':
          return <Dashboard />;
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

  const showBottomNav = ['chats', 'dashboard', 'profile', 'search'].includes(currentScreen);

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
      <div className="flex flex-col w-full h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-surface dark:bg-surface-dark text-text dark:text-text-inv overflow-hidden font-sans">
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
        <div style={{ width: sidebarWidth }} className="h-full flex flex-col border-r border-border/60 dark:border-border-dark/60 bg-surface dark:bg-surface-dark flex-shrink-0 relative">
          {/* Sidebar content: ChatList */}
          <div className="flex-1 overflow-y-auto">
            <ChatList
              onOpenChat={(connectionId, agentId, chatId) => navigate('chat_room', agentId, chatId, connectionId)}
              onOpenSplitChat={openSplitChat}
              onAddServer={() => navigate('pairing')}
              compact
              activeAgentId={activeAgentId}
              activeConnectionId={activeConnectionId}
              splitEnabled={isSplitViewport && currentScreen === 'chat_room'}
              splitActiveAgentId={splitAgentId}
              splitActiveConnectionId={splitConnectionId}
            />
          </div>

          {/* Sidebar nav — bottom */}
          <div className="flex items-center gap-0.5 px-2 py-2 border-t border-border/60 dark:border-border-dark/60 min-h-[48px]">
            {SIDEBAR_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === 'chats'
                ? (currentScreen === 'chats' || currentScreen === 'chat_room')
                : currentScreen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.id as Screen)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-all',
                    isActive ? 'bg-primary text-white' : 'text-text/40 dark:text-text-inv/30 hover:text-text/60 dark:hover:text-text-inv/50 hover:bg-text/[0.03] dark:hover:bg-text-inv/[0.03]'
                  )}
                >
                  <Icon size={15} />
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
        <div className="flex-1 h-full relative overflow-hidden">
          <UpdateBanner isVisible={updateAvailable} onUpdate={applyUpdate} onDismiss={dismissUpdate} />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={`${currentScreen}:${activeConnectionId || ''}:${activeAgentId || ''}:${activeChatId || ''}:${splitConnectionId || ''}:${splitAgentId || ''}:${splitChatId || ''}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={`absolute inset-0 ${currentScreen === 'chat_room' ? 'overflow-hidden' : 'overflow-y-auto'}`}
            >
              {renderDesktopMain()}
            </motion.div>
          </AnimatePresence>
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
          <BottomNav currentScreen={currentScreen} onNavigate={navigate} />
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

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
