import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useLogto } from '@logto/react';
import Onboarding from './screens/Onboarding';
import Callback from './screens/Callback';
import ChatList from './screens/ChatList';
import ChatRoom from './screens/ChatRoom';
import Dashboard from './screens/Dashboard';
import Profile from './screens/Profile';
import Search from './screens/Search';
import Preferences from './screens/Preferences';
import Pairing from './screens/Pairing';
import BottomNav from './components/BottomNav';
import UpdateBanner from './components/UpdateBanner';
import IOSInstallPrompt from './components/IOSInstallPrompt';
import { setActiveConnectionId } from './services/connectionStore';
import * as clawChannel from './services/clawChannel';
import { useSwipeBack } from './hooks/useSwipeBack';
import { usePWAUpdate } from './hooks/usePWAUpdate';
import { useIOSPWA } from './hooks/useIOSPWA';
import { cn } from './lib/utils';
import { MessageCircle, LayoutDashboard, Search as SearchIcon, User, Settings } from 'lucide-react';

export type Screen = 'onboarding' | 'callback' | 'chats' | 'chat_room' | 'dashboard' | 'profile' | 'search' | 'preferences' | 'pairing';

const STORAGE_KEY_USER_ID = 'openclaw.userId';
const STORAGE_KEY_USER_NAME = 'openclaw.userName';


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
  chat_room: '/chat',  // + /:chatId
  dashboard: '/dashboard',
  profile: '/profile',
  search: '/search',
  preferences: '/preferences',
  pairing: '/pairing',
};

function pathToScreen(pathname: string): { screen: Screen; chatId?: string } {
  if (pathname.startsWith('/chat/')) {
    return { screen: 'chat_room', chatId: pathname.slice('/chat/'.length) };
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
    return typeof window !== 'undefined' && window.innerWidth >= 768;
  });
  
  useEffect(() => {
    if (forcedMobile) return; // Skip listener if forced
    const mql = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [forcedMobile]);
  return isDesktop;
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

  const initialFromUrl = pathToScreen(location.pathname);
  const initialScreen: Screen = effectivelyAuthenticated ? (initialFromUrl.screen === 'onboarding' && location.pathname === '/' ? 'chats' : initialFromUrl.screen) : 'onboarding';

  const [currentScreen, setCurrentScreen] = useState<Screen>(initialScreen);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(initialFromUrl.chatId ?? null);

  // PWA update detection
  const { updateAvailable, applyUpdate, dismissUpdate } = usePWAUpdate();

  // iOS PWA optimizations
  const { showInstallPrompt } = useIOSPWA();

  // URL → Screen（浏览器前进/后退）
  useEffect(() => {
    const { screen, chatId } = pathToScreen(location.pathname);
    setCurrentScreen(screen);
    if (chatId) setActiveAgentId(chatId);
  }, [location.pathname]);

  const navigate = useCallback((screen: Screen, chatId?: string) => {
    setCurrentScreen(screen);
    if (chatId) setActiveAgentId(chatId);

    // Screen → URL
    if (screen === 'chat_room' && chatId) {
      routerNavigate(`/chat/${chatId}`);
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

  // ── Conditional returns AFTER all hooks ──

  // Handle /callback route
  if (location.pathname === '/callback') {
    return <Callback />;
  }

  // Show loading while Logto initializes (skip in dev mode)
  if (isAuthLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-[#F8FAFB] dark:bg-[#1a1b2e] text-[#2D3436] dark:text-[#e2e8f0]">
        <div className="w-10 h-10 border-4 border-[#67B88B] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const renderScreen = () => {
    // Redirect unauthenticated users to onboarding (except callback)
    if (!effectivelyAuthenticated && currentScreen !== 'onboarding' && currentScreen !== 'callback') {
      return <Onboarding onGetStarted={() => navigate('chats')} />;
    }
    switch (currentScreen) {
      case 'onboarding':
        return <Onboarding onGetStarted={() => navigate('chats')} />;
      case 'callback':
        return <Callback />;
      case 'chats':
        return <ChatList onOpenChat={(agentId) => navigate('chat_room', agentId)} onAddServer={() => navigate('pairing')} />;
      case 'chat_room':
        return <ChatRoom agentId={activeAgentId} onBack={() => navigate('chats')} />;
      case 'dashboard':
        return <Dashboard />;
      case 'profile':
        return <Profile onNavigate={navigate} />;
      case 'search':
        return <Search />;
      case 'preferences':
        return <Preferences onBack={() => navigate('profile')} />;
      case 'pairing':
        return <Pairing onBack={() => navigate('profile')} onPaired={(connId) => { clawChannel.close(); localStorage.removeItem('openclaw.agentList'); localStorage.removeItem('openclaw.channelStatus'); setActiveConnectionId(connId); navigate('chats'); }} />;
      default:
        return <Onboarding onGetStarted={() => navigate('chats')} />;
    }
  };

  // For desktop: which screen to show in the main panel (not chat list, since it's in sidebar)
  const renderDesktopMain = () => {
    switch (currentScreen) {
      case 'chat_room':
        return <ChatRoom agentId={activeAgentId} onBack={() => navigate('chats')} isDesktop />;
      case 'dashboard':
        return <Dashboard />;
      case 'profile':
        return <Profile onNavigate={navigate} />;
      case 'search':
        return <Search />;
      case 'preferences':
        return <Preferences onBack={() => navigate('profile')} />;
      case 'pairing':
        return <Pairing onBack={() => navigate('profile')} onPaired={(connId) => { clawChannel.close(); localStorage.removeItem('openclaw.agentList'); localStorage.removeItem('openclaw.channelStatus'); setActiveConnectionId(connId); navigate('chats'); }} />;
      case 'onboarding':
        return <Onboarding onGetStarted={() => navigate('chats')} />;
      default:
        // Default: show a welcome/empty state
        return (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-20 h-20 bg-gradient-to-br from-[#67B88B] to-[#4a9a70] rounded-3xl flex items-center justify-center mb-6 shadow-lg shadow-[#67B88B]/20">
              <MessageCircle size={36} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Clawline</h2>
            <p className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40 text-[15px]">Select a conversation from the sidebar to start chatting</p>
          </div>
        );
    }
  };

  const showBottomNav = ['chats', 'dashboard', 'profile', 'search'].includes(currentScreen);

  // ---- Desktop layout: sidebar + main ----
  if (isDesktop && currentScreen !== 'onboarding') {
    return (
      <div className="flex flex-col w-full h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-[#F8FAFB] dark:bg-[#1a1b2e] text-[#2D3436] dark:text-[#e2e8f0] overflow-hidden font-sans">
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
        <div className="w-80 xl:w-96 h-full flex flex-col border-r border-[#EDF2F0] dark:border-[#2d3748] bg-white/50 dark:bg-[#232437]/50 flex-shrink-0">
          {/* Sidebar nav */}
          <div className="flex items-center gap-1 px-3 py-2.5 border-b border-[#EDF2F0] dark:border-[#2d3748] min-h-[57px]">
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
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-medium transition-all',
                    isActive ? 'bg-[#67B88B] text-white shadow-sm' : 'text-[#2D3436]/50 dark:text-[#e2e8f0]/40 hover:bg-[#F8FAFB] dark:hover:bg-[#1a1b2e]'
                  )}
                >
                  <Icon size={16} />
                  <span className="hidden xl:inline">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Sidebar content: ChatList */}
          <div className="flex-1 overflow-y-auto">
            <ChatList
              onOpenChat={(agentId) => navigate('chat_room', agentId)}
              onAddServer={() => navigate('pairing')}
              compact
              activeAgentId={activeAgentId}
            />
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 h-full relative overflow-hidden">
          <UpdateBanner isVisible={updateAvailable} onUpdate={applyUpdate} onDismiss={dismissUpdate} />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={currentScreen + (activeAgentId || '')}
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
    <div className="relative w-full h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-[#F8FAFB] dark:bg-[#1a1b2e] text-[#2D3436] dark:text-[#e2e8f0] overflow-hidden flex flex-col font-sans">
      <div className="flex-1 flex justify-center relative min-h-0">
        <div className="w-full max-w-md h-full relative bg-[#F8FAFB] dark:bg-[#1a1b2e] shadow-2xl overflow-hidden">
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
            className={`absolute inset-0 ${currentScreen === 'chat_room' ? 'overflow-hidden' : 'overflow-y-auto'}`}
          >
            {/* Inner motion.div: handles swipe-back drag (decoupled from transitions) */}
            <motion.div
              style={{ x: dragX }}
              className={currentScreen === 'chat_room' ? 'h-full' : undefined}
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
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
