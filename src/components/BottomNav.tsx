import { MessageCircle, Search, User, Inbox } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Screen } from '../App';
import { motion } from 'motion/react';
import { GlassCard } from './ui/card';
import { cn } from '../lib/utils';
import { getUnreadTotal, onInboxUpdate } from '../services/agentInbox';

interface BottomNavProps {
  currentScreen: Screen;
  onNavigate: (screen: Screen) => void;
  unreadChats?: number;
}

export default function BottomNav({ currentScreen, onNavigate, unreadChats = 0 }: BottomNavProps) {
  const [inboxBadge, setInboxBadge] = useState(() => getUnreadTotal());

  useEffect(() => {
    const refresh = () => setInboxBadge(getUnreadTotal());
    const unsub = onInboxUpdate(refresh);
    return unsub;
  }, []);

  const navItems = [
    { id: 'chats', icon: MessageCircle, label: 'Chats', badge: unreadChats },
    { id: 'inbox', icon: Inbox, label: 'Inbox', badge: inboxBadge },
    { id: 'search', icon: Search, label: 'Search', badge: 0 },
    { id: 'profile', icon: User, label: 'Profile', badge: 0 },
  ];

  return (
    <div className="absolute left-6 right-6 z-50 pwa-nav-offset" style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom, 1.5rem))' }}>
      <GlassCard className="p-2 flex justify-between items-center px-6" role="navigation" aria-label="Main navigation">
        {navItems.map((item) => {
          const isActive = currentScreen === item.id;
          const Icon = item.icon;
          return (
            <motion.button
              key={item.id}
              whileTap={{ scale: 0.9 }}
              onClick={() => onNavigate(item.id as Screen)}
              aria-label={item.badge > 0 ? `${item.label} (${item.badge} unread)` : item.label}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                "p-2 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative min-w-[52px] min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isActive ? 'text-primary drop-shadow-[0_1px_2px_rgba(239,90,35,0.3)]' : 'text-text/35 dark:text-text-inv/35 hover:text-text/55 dark:hover:text-text-inv/55'
              )}
            >
              <div className="relative">
                <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                {item.badge > 0 && !isActive && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-primary text-white text-[10px] font-bold px-1 shadow-sm shadow-primary/30">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className={cn('text-[10px] leading-none', isActive ? 'font-semibold' : 'font-medium')}>
                {item.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="w-1 h-1 rounded-full bg-primary absolute -bottom-0.5"
                />
              )}
            </motion.button>
          );
        })}
      </GlassCard>
    </div>
  );
}
