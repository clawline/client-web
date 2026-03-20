import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 25 }}
      className="flex flex-col items-center justify-center text-center px-8 py-12"
    >
      <div className="w-14 h-14 bg-gradient-to-br from-primary/15 to-primary-deep/15 rounded-[16px] flex items-center justify-center mb-4">
        <Icon size={26} className="text-primary" />
      </div>
      <h3 className="text-[16px] font-semibold mb-1">{title}</h3>
      <p className="text-text/45 dark:text-text-inv/45 text-[14px] leading-relaxed max-w-[280px] mb-5">
        {description}
      </p>
      {action}
    </motion.div>
  );
}
