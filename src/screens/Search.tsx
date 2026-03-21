import { useEffect, useState } from 'react';
import { Search as SearchIcon, Command, FileText, MessageSquare, Clock, Image, Mic, Filter, X } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { searchMessages, type MessageRecord } from '../services/messageDB';

type SearchResult = MessageRecord;

type FilterType = 'all' | 'user' | 'ai' | 'image' | 'voice' | 'command';

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-inherit rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function formatSearchTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const filters: { id: FilterType; label: string; icon: typeof Filter; color: string }[] = [
  { id: 'all', label: 'All', icon: Filter, color: 'text-text/55 dark:text-text-inv/55' },
  { id: 'user', label: 'Sent', icon: MessageSquare, color: 'text-info' },
  { id: 'ai', label: 'Received', icon: MessageSquare, color: 'text-primary' },
  { id: 'image', label: 'Images', icon: Image, color: 'text-purple-500' },
  { id: 'voice', label: 'Voice', icon: Mic, color: 'text-amber-500' },
  { id: 'command', label: 'Commands', icon: Command, color: 'text-rose-500' },
];

export default function Search() {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const hasInput = query.trim() || activeFilter !== 'all';

  useEffect(() => {
    if (!hasInput) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;

    const searchOptions = (() => {
      if (activeFilter === 'user') return { sender: 'user' as const, limit: 100 };
      if (activeFilter === 'ai') return { sender: 'ai' as const, limit: 100 };
      if (activeFilter === 'image') return { mediaType: 'image', limit: 100 };
      if (activeFilter === 'voice') return { mediaType: 'voice', limit: 100 };
      if (activeFilter === 'command') return { commandOnly: true, limit: 100 };
      return { limit: 100 };
    })();

    setIsSearching(true);
    void searchMessages(query, searchOptions).then((nextResults) => {
      if (cancelled) return;
      setResults(nextResults);
      setIsSearching(false);
    }).catch(() => {
      if (cancelled) return;
      setResults([]);
      setIsSearching(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activeFilter, hasInput, query]);

  return (
    <div className="flex flex-col h-full pb-32 px-6 pt-12 max-w-2xl mx-auto w-full">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Search</h1>

      <div className="relative mb-4">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-text/40 dark:text-text-inv/40" size={20} />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages..."
          className="pl-12 pr-10 py-4 rounded-[24px] text-[16px] focus:ring-4 focus:ring-primary/10 bg-white dark:bg-card-alt"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-text/40 dark:text-text-inv/40 hover:text-text/70 dark:hover:text-text-inv/70 transition-colors"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-none">
        {filters.map((f) => {
          const Icon = f.icon;
          const isActive = activeFilter === f.id;
          return (
            <motion.button
              key={f.id}
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveFilter(isActive && f.id !== 'all' ? 'all' : f.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap border transition-colors ${
                isActive
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-white dark:bg-card-alt border-border dark:border-border-dark text-text/50 dark:text-text-inv/50 hover:border-primary/30'
              }`}
            >
              <Icon size={13} className={isActive ? 'text-primary' : f.color} />
              {f.label}
            </motion.button>
          );
        })}
      </div>

      {hasInput ? (
        <div className="space-y-2 overflow-y-auto flex-1">
          <AnimatePresence mode="popLayout">
            {isSearching ? (
              <div className="text-center text-text/30 dark:text-text-inv/30 py-12">
                <SearchIcon size={32} className="mx-auto mb-3 opacity-30 animate-pulse" />
                Searching messages…
              </div>
            ) : results.length > 0 ? results.map((msg, i) => (
              <motion.div
                key={`${msg.id}-${i}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
                className="bg-white dark:bg-card-alt p-4 rounded-[16px] border border-border dark:border-border-dark shadow-sm"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-semibold ${msg.sender === 'user' ? 'text-info' : 'text-primary'}`}>
                      {msg.sender === 'user' ? 'You' : 'AI'}
                    </span>
                    {msg.agentId && (
                      <span className="text-[11px] text-text/40 dark:text-text-inv/40 bg-surface dark:bg-surface-dark px-1.5 py-0.5 rounded">{msg.agentId}</span>
                    )}
                    {msg.mediaType && msg.mediaType !== 'text' && (
                      <span className="text-[11px] text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded">{msg.mediaType}</span>
                    )}
                  </div>
                  {msg.timestamp && (
                    <span className="text-[11px] text-text/30 dark:text-text-inv/30 flex items-center gap-1">
                      <Clock size={10} />
                      {formatSearchTime(msg.timestamp)}
                    </span>
                  )}
                </div>
                <p className="text-[14px] text-text dark:text-text-inv line-clamp-3 leading-relaxed">
                  {highlightMatch(msg.text ?? '', query)}
                </p>
              </motion.div>
            )) : (
              <div className="text-center text-text/30 dark:text-text-inv/30 py-12">
                <SearchIcon size={32} className="mx-auto mb-3 opacity-30" />
                No messages found
              </div>
            )}
          </AnimatePresence>
          {results.length > 0 && (
            <p className="text-center text-[11px] text-text/20 dark:text-text-inv/20 mt-4 pb-4">
              {results.length} result{results.length !== 1 ? 's' : ''}{results.length >= 100 ? '+' : ''}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <SearchIcon size={48} className="text-text/8 dark:text-text-inv/8 mb-4" />
          <p className="text-text/30 dark:text-text-inv/30 text-[15px] mb-1">Search across your conversations</p>
          <p className="text-text/20 dark:text-text-inv/20 text-[13px]">Use filters to narrow results</p>
        </div>
      )}
    </div>
  );
}
