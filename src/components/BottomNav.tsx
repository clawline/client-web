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
    { id: 'chats', icon: MessageCircle, label: 'Chats', color: '#67B88B' },
    { id: 'dashboard', icon: LayoutDashboard, label: 'Resources', color: '#5B8DEF' },
    { id: 'search', icon: Search, label: 'Search', color: '#F59E0B' },
    { id: 'profile', icon: User, label: 'Profile', color: '#8B5CF6' },
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
                "p-3 rounded-2xl flex flex-col items-center justify-center transition-colors relative",
                isActive ? '' : 'text-[#2D3436]/50 dark:text-[#e2e8f0]/50 hover:text-[#2D3436]/70 dark:hover:text-[#e2e8f0]/70'
              )}
              style={isActive ? { color: item.color } : undefined}
            >
              <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="w-1.5 h-1.5 rounded-full absolute -bottom-1"
                  style={{ backgroundColor: item.color }}
                />
              )}
            </motion.button>
          );
        })}
      </GlassCard>
    </div>
  );
}
