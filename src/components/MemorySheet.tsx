import { motion, AnimatePresence } from 'motion/react';
import { X, Database, Brain, Sparkles, Clock, Search } from 'lucide-react';
import { Button } from './ui/button';
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
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
              <Brain size={20} />
            </div>
            <div>
              <h3 className="font-bold text-[17px]">{agentName}'s Memory</h3>
              <p className="text-[12px] text-gray-400">Long-term context & recall</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={24} />
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-gray-400" size={16} />
            <Input className="pl-9 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700" placeholder="Search memories..." />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-800/30">
              <div className="text-[24px] font-bold text-indigo-600 dark:text-indigo-400">1,024</div>
              <div className="text-[12px] text-indigo-600/70 dark:text-indigo-400/70 font-medium">Total Memories</div>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-800/30">
              <div className="text-[24px] font-bold text-emerald-600 dark:text-emerald-400">98%</div>
              <div className="text-[12px] text-emerald-600/70 dark:text-emerald-400/70 font-medium">Recall Accuracy</div>
            </div>
          </div>

          <h4 className="text-[13px] font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
            <Sparkles size={14} /> Recent Activities
          </h4>

          {/* Placeholder Memories */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-[14px] leading-relaxed text-gray-700 dark:text-gray-300">
                    User discussed project architecture preferences regarding modular component design and strict TypeScript usage.
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-400">
                    <Clock size={10} />
                    <span>2 hours ago</span>
                    <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
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
