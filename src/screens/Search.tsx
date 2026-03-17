import { useState, useMemo } from 'react';
import { Search as SearchIcon, Command, FileText, MessageSquare, Clock } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { motion } from 'motion/react';

type CachedMessage = {
  id: string;
  sender: string;
  text: string;
  timestamp?: number;
  agentId?: string;
  connId?: string;
};

function searchLocalMessages(query: string): CachedMessage[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase();
  const results: CachedMessage[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('openclaw.messages.')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const msgs = JSON.parse(raw) as CachedMessage[];
      for (const m of msgs) {
        if (m.text?.toLowerCase().includes(lower)) {
          results.push(m);
        }
      }
    }
  } catch { /* ignore */ }
  return results.slice(-50);
}

export default function Search() {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchLocalMessages(query), [query]);

  return (
    <div className="flex flex-col h-full pb-32 px-6 pt-12 max-w-2xl mx-auto w-full">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Search</h1>
      
      <div className="relative mb-6">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-[#2D3436]/40 dark:text-[#e2e8f0]/40" size={20} />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages..."
          className="pl-12 py-4 rounded-[24px] text-[16px] focus:ring-4 focus:ring-[#67B88B]/10 bg-white dark:bg-[#232437]"
        />
      </div>

      {query.trim() ? (
        <div className="space-y-2 overflow-y-auto">
          {results.length > 0 ? results.map((msg, i) => (
            <motion.div
              key={`${msg.id}-${i}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className="bg-white dark:bg-[#232437] p-4 rounded-[16px] border border-[#EDF2F0] dark:border-[#2d3748] shadow-sm"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-medium text-[#67B88B]">{msg.sender === 'user' ? 'You' : 'AI'}</span>
                {msg.timestamp && (
                  <span className="text-[11px] text-[#2D3436]/30 dark:text-[#e2e8f0]/30 flex items-center gap-1">
                    <Clock size={10} />
                    {new Date(msg.timestamp).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-[14px] text-[#2D3436] dark:text-[#e2e8f0] line-clamp-3">{msg.text}</p>
            </motion.div>
          )) : (
            <div className="text-center text-[#2D3436]/30 dark:text-[#e2e8f0]/30 py-12">No messages found</div>
          )}
          <p className="text-center text-[11px] text-[#2D3436]/20 dark:text-[#e2e8f0]/20 mt-4">{results.length} result{results.length !== 1 ? 's' : ''}</p>
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h3 className="text-sm font-semibold text-[#2D3436]/50 dark:text-[#e2e8f0]/50 mb-3 uppercase tracking-wider">Quick Filters</h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setQuery('/')}>
                <Command size={14} className="text-purple-500" /> Commands
              </Button>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setQuery('[Image]')}>
                <FileText size={14} className="text-blue-500" /> Images
              </Button>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setQuery('[Voice]')}>
                <MessageSquare size={14} className="text-[#67B88B]" /> Voice
              </Button>
            </div>
          </section>

          <div className="flex flex-col items-center justify-center py-12 text-center">
            <SearchIcon size={40} className="text-[#2D3436]/10 dark:text-[#e2e8f0]/10 mb-4" />
            <p className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30 text-[15px]">Search across your conversations</p>
          </div>
        </div>
      )}
    </div>
  );
}
