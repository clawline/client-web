import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Screen = 'onboarding' | 'callback' | 'chats' | 'chat_room' | 'dashboard' | 'inbox' | 'profile' | 'search' | 'preferences' | 'pairing';

export type SplitPane = {
  connectionId: string;
  agentId: string;
  chatId: string | null;
};

const SPLIT_PANES_KEY = 'clawline.split.panes';
const EMPTY_SPLIT_VALUE = '__empty__';

interface NavigationState {
  currentScreen: Screen;
  activeAgentId: string | null;
  activeChatId: string | null;
  activeConnectionId: string | null;
  splitPanes: SplitPane[];

  setCurrentScreen: (screen: Screen) => void;
  setActiveAgentId: (id: string | null) => void;
  setActiveChatId: (id: string | null) => void;
  setActiveConnectionId: (id: string | null) => void;
  setSplitPanes: (panes: SplitPane[] | ((prev: SplitPane[]) => SplitPane[])) => void;
}

function loadInitialSplitPanes(): SplitPane[] {
  if (typeof window !== 'undefined' && window.innerWidth >= 1440) {
    const saved = localStorage.getItem('clawline.split.enabled');
    if (saved === 'off') return [];
    try {
      const raw = localStorage.getItem(SPLIT_PANES_KEY);
      if (raw) {
        const parsed: SplitPane[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return [{ connectionId: EMPTY_SPLIT_VALUE, agentId: EMPTY_SPLIT_VALUE, chatId: null }];
  }
  return [];
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      currentScreen: 'chats',
      activeAgentId: null,
      activeChatId: null,
      activeConnectionId: null,
      splitPanes: loadInitialSplitPanes(),

      setCurrentScreen: (screen) => set({ currentScreen: screen }),
      setActiveAgentId: (id) => set({ activeAgentId: id }),
      setActiveChatId: (id) => set({ activeChatId: id }),
      setActiveConnectionId: (id) => set({ activeConnectionId: id }),
      setSplitPanes: (panes) =>
        set((state) => ({
          splitPanes: typeof panes === 'function' ? panes(state.splitPanes) : panes,
        })),
    }),
    {
      name: SPLIT_PANES_KEY,
      partialize: (state) => ({
        splitPanes: state.splitPanes.filter(
          (p) => p.agentId !== EMPTY_SPLIT_VALUE,
        ),
      }),
    },
  ),
);
