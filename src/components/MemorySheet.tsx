import { motion } from 'motion/react';
import { X, Database, Brain, Sparkles, Clock, Search } from 'lucide-react';
import { Input } from './ui/input';

export default function MemorySheet({ onClose, agentName }: { onClose: () => void; agentName: string }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-surface-dark rounded-t-[32px] max-h-[85vh] h-full flex flex-col shadow-2xl border-t border-white/10"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-border dark:border-border-dark">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
              <Brain size={20} />
            </div>
            <div>
              <h3 className="font-bold text-[17px] text-text dark:text-text-inv">{agentName}&rsquo;s Memory</h3>
              <p className="text-[12px] text-text/45 dark:text-text-inv/45">Long-term context &amp; recall</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-text/45 dark:text-text-inv/45 hover:text-text dark:hover:text-text-inv transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-text/40 dark:text-text-inv/40" size={16} />
            <Input className="pl-9 bg-surface dark:bg-surface-dark border-border dark:border-border-dark" placeholder="Search memories..." />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-accent/10 p-4 rounded-2xl border border-accent/20">
              <div className="text-[24px] font-bold text-accent">1,024</div>
              <div className="text-[12px] text-accent/70 font-medium">Total Memories</div>
            </div>
            <div className="bg-primary/10 p-4 rounded-2xl border border-primary/20">
              <div className="text-[24px] font-bold text-primary">98%</div>
              <div className="text-[12px] text-primary/70 font-medium">Recall Accuracy</div>
            </div>
          </div>

          <h4 className="text-[13px] font-bold uppercase tracking-wider text-text/40 dark:text-text-inv/40 mb-3 flex items-center gap-2">
            <Sparkles size={14} /> Recent Activities
          </h4>

          {/* Placeholder Memories */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-card-alt p-4 rounded-2xl border border-border dark:border-border-dark shadow-sm">
              <div className="flex items-start gap-3">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                <div className="flex-1">
                  <p className="text-[14px] leading-relaxed text-text/80 dark:text-text-inv/80">
                    User discussed project architecture preferences regarding modular component design and strict TypeScript usage.
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-text/40 dark:text-text-inv/40">
                    <Clock size={10} />
                    <span>2 hours ago</span>
                    <span className="w-1 h-1 rounded-full bg-text/25 dark:bg-text-inv/25" />
                    <Database size={10} />
                    <span>Preference</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </>
  );
}
