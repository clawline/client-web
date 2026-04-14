import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Command, FileText, MessageSquare, Clock, Image, Mic, Filter, X, ArrowUpDown, History, Server } from 'lucide-react';
import { Input } from '../components/ui/input';
import { motion, AnimatePresence } from 'motion/react';

type SearchResult = {
  id: string;
  connectionId: string;
  agentId: string;
  sender: string;
  text: string;
  timestamp: number;
  chatId?: string;
  mediaType?: string;
  mediaUrl?: string;
  serverName?: string;
};

type FilterType = 'all' | 'user' | 'ai' | 'image' | 'voice' | 'command';
type SortMode = 'relevance' | 'timeline';

type CachedAgentInfo = {
  id: string;
  name?: string;
  identityEmoji?: string;
};

type CachedConnectionInfo = {
  id: string;
  name?: string;
  displayName?: string;
  channelName?: string;
};

type EnrichedSearchResult = SearchResult & {
  agentName: string;
  serverName: string;
  groupKey: string;
  matchCount: number;
};

type SearchGroup = {
  key: string;
  agentId: string;
  agentName: string;
  serverName: string;
  results: EnrichedSearchResult[];
  latestTimestamp: number;
  relevanceScore: number;
};

function highlightMatch(text: string, query: string): React.ReactNode {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return text;

  const pattern = new RegExp(`(${trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  const parts = text.split(pattern);

  if (parts.length <= 1) {
    return text;
  }

  return parts.map((part, index) => (
    part.toLowerCase() === trimmedQuery.toLowerCase()
      ? <mark key={`${part}-${index}`} className="bg-primary/20 text-inherit rounded px-0.5">{part}</mark>
      : <span key={`${part}-${index}`}>{part}</span>
  ));
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

function countMatches(text: string, query: string): number {
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) return 0;

  let count = 0;
  let offset = 0;

  while (offset < normalizedText.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, offset);
    if (matchIndex === -1) break;
    count += 1;
    offset = matchIndex + normalizedQuery.length;
  }

  return count;
}

function readCachedAgents(connectionId: string): CachedAgentInfo[] {
  try {
    const raw = localStorage.getItem(`openclaw.agentList.${connectionId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is CachedAgentInfo => (
      typeof item === 'object' &&
      item !== null &&
      'id' in item &&
      typeof item.id === 'string'
    )) : [];
  } catch {
    return [];
  }
}

function readCachedConnections(): CachedConnectionInfo[] {
  try {
    const raw = localStorage.getItem('openclaw.connections');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is CachedConnectionInfo => (
      typeof item === 'object' &&
      item !== null &&
      'id' in item &&
      typeof item.id === 'string'
    )) : [];
  } catch {
    return [];
  }
}

function getAgentName(connectionId: string, agentId: string, cachedAgents: CachedAgentInfo[]): string {
  const match = cachedAgents.find((agent) => agent.id === agentId);
  if (!match) return agentId;
  const name = match.name?.trim();
  return name ? `${match.identityEmoji ? `${match.identityEmoji} ` : ''}${name}` : agentId;
}

function getServerName(connectionId: string, cachedConnections: CachedConnectionInfo[]): string {
  const match = cachedConnections.find((connection) => connection.id === connectionId);
  return match?.channelName || match?.name || match?.displayName || 'Server';
}

function buildGroups(results: SearchResult[], query: string, sortMode: SortMode): SearchGroup[] {
  const cachedConnections = readCachedConnections();
  const cachedAgentsByConnection = new Map<string, CachedAgentInfo[]>();
  const groups = new Map<string, SearchGroup>();

  results.forEach((result) => {
    const cachedAgents = cachedAgentsByConnection.get(result.connectionId) ?? readCachedAgents(result.connectionId);
    cachedAgentsByConnection.set(result.connectionId, cachedAgents);

    const agentName = getAgentName(result.connectionId, result.agentId, cachedAgents);
    const serverName = getServerName(result.connectionId, cachedConnections);
    const groupKey = `${result.connectionId}:${result.agentId}`;
    const matchCount = countMatches(result.text ?? '', query);
    const enrichedResult: EnrichedSearchResult = {
      ...result,
      agentName,
      serverName,
      groupKey,
      matchCount,
    };

    const existing = groups.get(groupKey);
    if (existing) {
      existing.results.push(enrichedResult);
      existing.latestTimestamp = Math.max(existing.latestTimestamp, result.timestamp ?? 0);
      existing.relevanceScore += matchCount;
      return;
    }

    groups.set(groupKey, {
      key: groupKey,
      agentId: result.agentId,
      agentName,
      serverName,
      results: [enrichedResult],
      latestTimestamp: result.timestamp ?? 0,
      relevanceScore: matchCount,
    });
  });

  const nextGroups = [...groups.values()].map((group) => ({
    ...group,
    results: [...group.results].sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0)),
  }));

  return nextGroups.sort((left, right) => {
    if (sortMode === 'relevance' && query.trim()) {
      if (right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }
    }
    return right.latestTimestamp - left.latestTimestamp;
  });
}

const filters: { id: FilterType; label: string; icon: typeof Filter; color: string }[] = [
  { id: 'all', label: 'All', icon: Filter, color: 'text-text/55 dark:text-text-inv/55' },
  { id: 'user', label: 'Sent', icon: MessageSquare, color: 'text-info' },
  { id: 'ai', label: 'Received', icon: MessageSquare, color: 'text-primary' },
  { id: 'image', label: 'Images', icon: Image, color: 'text-purple-500' },
  { id: 'voice', label: 'Voice', icon: Mic, color: 'text-amber-500' },
  { id: 'command', label: 'Commands', icon: Command, color: 'text-rose-500' },
];

const sortTabs: { id: SortMode; label: string; icon: typeof ArrowUpDown }[] = [
  { id: 'relevance', label: '相关度', icon: ArrowUpDown },
  { id: 'timeline', label: '时间线', icon: History },
];

export default function Search() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const hasInput = query.trim() || activeFilter !== 'all';
  const groupedResults = buildGroups(results, query, sortMode);

  useEffect(() => {
    if (!hasInput) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    // Search temporarily unavailable (IndexedDB removed, API search pending)
    setResults([]);
    setIsSearching(false);
  }, [activeFilter, hasInput, query]);

  return (
    <div className="flex flex-col h-full pb-32 px-6 pt-12 max-w-3xl mx-auto w-full">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Search</h1>

      <div className="relative mb-3">
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

      <div className="mb-4 rounded-[22px] border border-border/70 dark:border-border-dark/70 bg-white/75 dark:bg-card-alt/75 p-1 backdrop-blur-sm">
        <div className="grid grid-cols-2 gap-1">
          {sortTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = sortMode === tab.id;
            return (
              <motion.button
                key={tab.id}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSortMode(tab.id)}
                className={`flex items-center justify-center gap-2 rounded-[18px] px-4 py-2.5 text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-white shadow-lg shadow-primary/20'
                    : 'text-text/55 dark:text-text-inv/55 hover:bg-surface dark:hover:bg-surface-dark'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </motion.button>
            );
          })}
        </div>
      </div>

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
        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <AnimatePresence mode="popLayout">
            {isSearching ? (
              <div className="text-center text-text/30 dark:text-text-inv/30 py-12">
                <SearchIcon size={32} className="mx-auto mb-3 opacity-30 animate-pulse" />
                Searching messages…
              </div>
            ) : groupedResults.length > 0 ? groupedResults.map((group, groupIndex) => (
              <motion.section
                key={group.key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ delay: Math.min(groupIndex * 0.04, 0.2) }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between gap-3 px-1">
                  <div>
                    <h2 className="text-[15px] font-semibold text-text dark:text-text-inv">{group.agentName}</h2>
                    <p className="text-[11px] text-text/40 dark:text-text-inv/40">
                      {group.serverName} · {group.results.length} result{group.results.length !== 1 ? 's' : ''} in this thread
                    </p>
                  </div>
                  {sortMode === 'relevance' && query.trim() ? (
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                      {group.relevanceScore} match{group.relevanceScore !== 1 ? 'es' : ''}
                    </span>
                  ) : null}
                </div>

                {group.results.map((msg, index) => (
                  <motion.button
                    key={`${msg.id}-${index}`}
                    type="button"
                    whileTap={{ scale: 0.99 }}
                    onClick={() => {
                      const params = new URLSearchParams();
                      params.set('connectionId', msg.connectionId);
                      if (msg.chatId) {
                        params.set('chatId', msg.chatId);
                      }
                      navigate({
                        pathname: `/chat/${encodeURIComponent(msg.agentId)}`,
                        search: `?${params.toString()}`,
                      });
                    }}
                    className="w-full text-left bg-white dark:bg-card-alt p-4 rounded-[18px] border border-border dark:border-border-dark shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/[0.03] dark:hover:bg-primary/5"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[12px] font-semibold ${msg.sender === 'user' ? 'text-info' : 'text-primary'}`}>
                          {msg.sender === 'user' ? 'You' : 'AI'}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface dark:bg-surface-dark px-2 py-1 text-[11px] text-text/55 dark:text-text-inv/55">
                          <Server size={11} />
                          {msg.serverName}
                        </span>
                        {msg.mediaType && msg.mediaType !== 'text' && (
                          <span className="text-[11px] text-purple-500 bg-purple-50 dark:bg-purple-900/20 px-2 py-1 rounded-full">
                            {msg.mediaType}
                          </span>
                        )}
                        {sortMode === 'relevance' && query.trim() && msg.matchCount > 0 ? (
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                            {msg.matchCount} hit{msg.matchCount !== 1 ? 's' : ''}
                          </span>
                        ) : null}
                      </div>
                      {msg.timestamp && (
                        <span className="text-[11px] text-text/30 dark:text-text-inv/30 flex items-center gap-1 shrink-0">
                          <Clock size={10} />
                          {formatSearchTime(msg.timestamp)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-2xl bg-primary/10 p-2 text-primary">
                        <FileText size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] text-text dark:text-text-inv line-clamp-3 leading-relaxed">
                          {highlightMatch(msg.text ?? '', query)}
                        </p>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </motion.section>
            )) : (
              <div className="text-center text-text/30 dark:text-text-inv/30 py-12">
                <SearchIcon size={32} className="mx-auto mb-3 opacity-30" />
                No messages found
              </div>
            )}
          </AnimatePresence>
          {results.length > 0 && (
            <p className="text-center text-[11px] text-text/20 dark:text-text-inv/20 mt-2 pb-4">
              {results.length} result{results.length !== 1 ? 's' : ''}{results.length >= 100 ? '+' : ''}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <SearchIcon size={48} className="text-text/8 dark:text-text-inv/8 mb-4" />
          <p className="text-text/30 dark:text-text-inv/30 text-[15px] mb-1">Search across your conversations</p>
          <p className="text-text/20 dark:text-text-inv/20 text-[13px]">Switch between relevance and timeline, then narrow results with filters.</p>
        </div>
      )}
    </div>
  );
}
