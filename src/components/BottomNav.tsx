import { MessageCircle, LayoutDashboard, Search, User } from 'lucide-react';
import { Screen } from '../App';
import { motion } from 'motion/react';
import { GlassCard } from './ui/card';
import { cn } from '../lib/utils';

interface BottomNavProps {
  currentScreen: Screen;
  onNavigate: (screen: Screen) => void;
}

export default function BottomNav({ currentScreen, onNavigate }: BottomNavProps) {
  const navItems = [
    { id: 'chats', icon: MessageCircle, label: 'Chats' },
    { id: 'dashboard', icon: LayoutDashboard, label: 'Resources' },
    { id: 'search', icon: Search, label: 'Search' },
    { id: 'profile', icon: User, label: 'Profile' },
  ];

  return (
    <div className="absolute left-6 right-6 z-50" style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom, 1.5rem))' }}>
      <GlassCard className="p-2 flex justify-between items-center px-6" role="navigation" aria-label="Main navigation">
        {navItems.map((item) => {
          const isActive = currentScreen === item.id;
          const Icon = item.icon;
          return (
            <motion.button
              key={item.id}
              whileTap={{ scale: 0.9 }}
              onClick={() => onNavigate(item.id as Screen)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                "p-2 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative min-w-[52px]",
                isActive ? 'text-primary' : 'text-text/35 dark:text-text-inv/35 hover:text-text/55 dark:hover:text-text-inv/55'
              )}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
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
