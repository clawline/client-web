import { memo, useEffect, useMemo, useRef, useCallback, useState, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowLeft, MessageSquareText, MoreVertical, MessageCircle, Users, User, Loader2, ArrowDown, Plus, ArrowUp, Paperclip, Image, FileText, Archive, Lock, Unlock, Trash2 } from 'lucide-react';
import { useThreadStore } from '../../stores/threadStore';
import { getMessages as getCachedMessages } from '../../stores/messageCache';
import * as channel from '../../services/clawChannel';
import { formatTime } from './utils';
import MarkdownRenderer from '../MarkdownRenderer';
import { MessageItem } from './MessageItem';
import type { AgentInfo } from './types';

interface ThreadPanelProps {
  /** Whether the viewport is >=768px wide */
  isWide: boolean;
  /** Connection ID for looking up parent message from cache */
  connId?: string;
  /** Agent ID for looking up parent message from cache */
  agentId?: string;
}

/** Overlapping avatar circles for thread participants (max 3 shown) */
function ParticipantAvatars({ participantIds }: { participantIds: string[] }) {
  const shown = participantIds.slice(0, 3);
  const extra = participantIds.length - 3;

  if (shown.length === 0) return null;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((id) => (
          <div
            key={id}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-info to-accent text-[10px] text-white dark:border-surface-dark"
            title={id}
          >
            <User size={12} />
          </div>
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-1 text-[11px] font-medium text-text/50 dark:text-text-inv/50">
          +{extra}
        </span>
      )}
    </div>
  );
}

/** Threshold in pixels — if user is within this distance from bottom, auto-scroll on new messages */
const AUTO_SCROLL_THRESHOLD = 80;

/** Convert a File to base64 data URL */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Thread input box — text + image/file upload */
function ThreadInput({ connId, agentId }: { connId?: string; agentId?: string }) {
  const { sendThreadMessage, sendThreadMedia, activeThreadId } = useThreadStore();
  const [inputValue, setInputValue] = useState('');
  const [pendingFile, setPendingFile] = useState<{ file: File; dataUrl: string; isImage: boolean } | null>(null);
  const [fileCaption, setFileCaption] = useState('');
  const [showMoreIcons, setShowMoreIcons] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [inputValue]);

  // Reset input when thread changes
  useEffect(() => {
    setInputValue('');
    setPendingFile(null);
    setFileCaption('');
    setShowMoreIcons(false);
  }, [activeThreadId]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    sendThreadMessage(trimmed, agentId, connId);
    setInputValue('');
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [inputValue, sendThreadMessage, agentId, connId]);

  const handleImageSelected = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const dataUrl = await fileToDataUrl(file);
    setPendingFile({ file, dataUrl, isImage: true });
    setFileCaption('');
  }, []);

  const handleFileSelected = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const dataUrl = await fileToDataUrl(file);
    const isImage = file.type.startsWith('image/');
    setPendingFile({ file, dataUrl, isImage });
    setFileCaption('');
  }, []);

  const handleSendPendingFile = useCallback(async () => {
    if (!pendingFile) return;
    const { file, dataUrl } = pendingFile;
    const caption = fileCaption.trim();

    let finalUrl = dataUrl;
    // Upload large files to relay to save WS bandwidth
    if (file.size > 100 * 1024) {
      try {
        finalUrl = await channel.uploadFile(file, connId);
      } catch {
        // Fall back to base64
      }
    }

    sendThreadMedia({
      content: caption || file.name,
      mediaUrl: finalUrl,
      mimeType: file.type,
      fileName: file.name,
    }, agentId, connId);

    setPendingFile(null);
    setFileCaption('');
    setShowMoreIcons(false);
  }, [pendingFile, fileCaption, sendThreadMedia, agentId, connId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (pendingFile) {
        handleSendPendingFile();
      } else {
        handleSend();
      }
    }
  }, [handleSend, handleSendPendingFile, pendingFile]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const dataUrl = await fileToDataUrl(file);
        const isImage = file.type.startsWith('image/');
        setPendingFile({ file, dataUrl, isImage });
        setFileCaption(inputValue.trim());
        return;
      }
    }
  }, [inputValue]);

  return (
    <div className="border-t border-border/70 px-3 py-2 dark:border-border-dark/70">
      {/* Hidden file inputs */}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelected} />
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />

      {/* Pending file/image preview */}
      <AnimatePresence>
        {pendingFile && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 overflow-hidden"
          >
            <div className="flex items-start gap-3 rounded-[16px] border border-border/60 bg-white/96 p-2.5 dark:border-border-dark/60 dark:bg-card-alt/96">
              {pendingFile.isImage ? (
                <img src={pendingFile.dataUrl} alt="Preview" className="h-10 w-10 rounded-lg border border-border object-cover dark:border-border-dark" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-primary dark:border-border-dark dark:bg-surface-dark">
                  <FileText size={18} />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <div className="flex items-center justify-between">
                  <span className="truncate pr-2 text-[12px] font-medium text-text dark:text-text-inv">{pendingFile.file.name}</span>
                  <button onClick={() => { setPendingFile(null); setFileCaption(''); }} className="rounded-full p-1 text-text/50 transition-colors hover:bg-surface dark:text-text-inv/50 dark:hover:bg-surface-dark">
                    <X size={12} />
                  </button>
                </div>
                <input
                  type="text"
                  value={fileCaption}
                  onChange={(e) => setFileCaption(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSendPendingFile();
                    }
                  }}
                  placeholder="Add a caption..."
                  className="w-full bg-transparent text-[11px] text-slate-600 outline-none placeholder:text-slate-400 dark:text-slate-300 dark:placeholder:text-slate-500"
                  autoFocus
                />
              </div>
              <button onClick={handleSendPendingFile} className="self-center rounded-full bg-primary p-1.5 text-white shadow-sm transition-all hover:scale-105">
                <ArrowUp size={12} strokeWidth={2.5} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative flex items-end gap-0.5 rounded-[18px] border border-border/50 bg-surface/50 px-1.5 py-1 dark:border-border-dark/50 dark:bg-white/[0.03]">
        {/* Action menu popover */}
        <AnimatePresence>
          {showMoreIcons && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-20"
                onClick={() => setShowMoreIcons(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                className="absolute bottom-full left-0 z-30 mb-2 flex min-w-[120px] flex-col gap-0.5 rounded-2xl border border-border/70 bg-white/96 p-1.5 shadow-lg dark:border-border-dark/70 dark:bg-card-alt/96"
              >
                <button
                  onClick={() => { imageInputRef.current?.click(); setShowMoreIcons(false); }}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
                >
                  <Image size={16} />
                  Image
                </button>
                <button
                  onClick={() => { fileInputRef.current?.click(); setShowMoreIcons(false); }}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
                >
                  <Paperclip size={16} />
                  File
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* + button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowMoreIcons(!showMoreIcons)}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${showMoreIcons ? 'bg-primary/10 text-primary' : 'text-text/40 hover:text-text/60 dark:text-text-inv/40 dark:hover:text-text-inv/60'}`}
          aria-label="Attach"
        >
          <Plus size={16} />
        </motion.button>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder="Reply in thread..."
          aria-label="Reply in thread"
          className="flex-1 min-w-0 resize-none overflow-y-auto bg-transparent border-none px-1 py-1 text-[13px] text-text placeholder:text-[13px] placeholder:text-text/30 focus:outline-none dark:text-text-inv dark:placeholder:text-text-inv/25 leading-[1.45]"
        />

        {/* Send button */}
        <AnimatePresence>
          {inputValue.trim() && (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleSend}
              aria-label="Send message"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-sm"
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Thread options dropdown menu — shows context-aware actions based on thread status */
function ThreadOptionsMenu({
  thread,
  onClose,
  connectionId,
}: {
  thread: { id: string; status: string };
  onClose: () => void;
  connectionId?: string;
}) {
  const { updateThread, deleteThread: deleteThreadAction } = useThreadStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleArchive = () => {
    updateThread(thread.id, { status: 'archived' as const }, connectionId);
    onClose();
  };
  const handleUnarchive = () => {
    updateThread(thread.id, { status: 'active' as const }, connectionId);
    onClose();
  };
  const handleLock = () => {
    updateThread(thread.id, { status: 'locked' as const }, connectionId);
    onClose();
  };
  const handleUnlock = () => {
    updateThread(thread.id, { status: 'active' as const }, connectionId);
    onClose();
  };
  const handleDeleteConfirm = () => {
    deleteThreadAction(thread.id, connectionId);
    onClose();
  };

  if (showDeleteConfirm) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] bg-black/30"
          onClick={() => { setShowDeleteConfirm(false); onClose(); }}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="fixed inset-0 z-[71] flex items-center justify-center p-4"
        >
          <div className="w-full max-w-[320px] rounded-2xl bg-white p-5 shadow-xl dark:bg-surface-dark">
            <div className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-red-600">
              <Trash2 size={18} />
              Delete Thread
            </div>
            <p className="mb-4 text-[13px] leading-relaxed text-text/70 dark:text-text-inv/70">
              Delete this thread? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDeleteConfirm(false); onClose(); }}
                className="rounded-xl px-4 py-2 text-[13px] font-medium text-text/70 transition-colors hover:bg-slate-100 dark:text-text-inv/70 dark:hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="rounded-xl bg-red-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </motion.div>
      </>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-30"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.95 }}
        className="absolute right-2 top-full z-40 mt-1 flex min-w-[180px] flex-col gap-0.5 rounded-2xl border border-border/70 bg-white/96 p-1.5 shadow-lg dark:border-border-dark/70 dark:bg-card-alt/96"
      >
        {/* Archive / Unarchive */}
        {thread.status === 'archived' ? (
          <button
            onClick={handleUnarchive}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
          >
            <Archive size={16} />
            Unarchive Thread
          </button>
        ) : thread.status === 'active' ? (
          <button
            onClick={handleArchive}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
          >
            <Archive size={16} />
            Archive Thread
          </button>
        ) : null}

        {/* Lock / Unlock */}
        {thread.status === 'locked' ? (
          <button
            onClick={handleUnlock}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
          >
            <Unlock size={16} />
            Unlock Thread
          </button>
        ) : thread.status === 'active' ? (
          <button
            onClick={handleLock}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
          >
            <Lock size={16} />
            Lock Thread
          </button>
        ) : null}

        {/* Delete */}
        <div className="my-0.5 border-t border-border/40 dark:border-border-dark/40" />
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10"
        >
          <Trash2 size={16} />
          Delete Thread
        </button>
      </motion.div>
    </>
  );
}

/**
 * Adaptive thread panel — sidebar on wide screens, fullscreen overlay on narrow.
 * US-010: Shell. US-011: Header with parent message. US-012: Message list with scroll loading.
 */
function ThreadPanelInner({ isWide, connId, agentId }: ThreadPanelProps) {
  const {
    isThreadPanelOpen, activeThreadId, closeThread, threads,
    threadMessages, isLoadingMessages, isLoadingOlderMessages,
    hasMoreMessages, loadOlderMessages,
  } = useThreadStore();

  // Options menu state
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const optionsMenuAnchorRef = useRef<HTMLDivElement>(null);

  const activeThread = activeThreadId ? threads.get(activeThreadId) ?? null : null;
  const messages = activeThreadId ? threadMessages.get(activeThreadId) ?? [] : [];

  // Refs for scroll management
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const prevMessageCountRef = useRef(0);
  const didInitialScrollRef = useRef(false);

  // Look up the parent message from the main message cache
  const parentMessage = useMemo(() => {
    if (!activeThread?.parentMessageId || !connId) return null;
    const cached = getCachedMessages(connId, agentId || '');
    return cached.find((m) => m.id === activeThread.parentMessageId) ?? null;
  }, [activeThread?.parentMessageId, connId, agentId]);

  // Minimal agentInfo for MessageItem (thread messages don't have full agent context)
  const threadAgentInfo: AgentInfo | null = useMemo(() => {
    if (!agentId) return null;
    return { id: agentId, name: 'Bot', isDefault: false };
  }, [agentId]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  // Initial scroll to bottom when thread opens / messages first load
  useEffect(() => {
    if (activeThreadId && messages.length > 0 && !isLoadingMessages && !didInitialScrollRef.current) {
      // Wait for DOM render
      requestAnimationFrame(() => {
        scrollToBottom(false);
        didInitialScrollRef.current = true;
      });
    }
  }, [activeThreadId, messages.length, isLoadingMessages, scrollToBottom]);

  // Reset initial scroll ref when thread changes
  useEffect(() => {
    didInitialScrollRef.current = false;
    setHasNewMessages(false);
    setIsNearBottom(true);
    prevMessageCountRef.current = 0;
  }, [activeThreadId]);

  // Track new incoming messages for auto-scroll / pill
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && prevMessageCountRef.current > 0 && didInitialScrollRef.current) {
      if (isNearBottom) {
        requestAnimationFrame(() => scrollToBottom(true));
      } else {
        setHasNewMessages(true);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, isNearBottom, scrollToBottom]);

  // Scroll event handler — track proximity to bottom
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < AUTO_SCROLL_THRESHOLD;
    setIsNearBottom(nearBottom);
    if (nearBottom) setHasNewMessages(false);
  }, []);

  // IntersectionObserver to load older messages when top sentinel is visible
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container || !activeThreadId) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreMessages && !isLoadingOlderMessages && didInitialScrollRef.current) {
          loadOlderMessages(connId);
        }
      },
      { root: container, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeThreadId, hasMoreMessages, isLoadingOlderMessages, loadOlderMessages, connId]);

  // Preserve scroll position after older messages are prepended
  const prevScrollHeightRef = useRef(0);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Save before render
    prevScrollHeightRef.current = el.scrollHeight;
  });
  useEffect(() => {
    if (!isLoadingOlderMessages && prevScrollHeightRef.current > 0) {
      const el = scrollContainerRef.current;
      if (!el) return;
      const newScrollHeight = el.scrollHeight;
      const diff = newScrollHeight - prevScrollHeightRef.current;
      if (diff > 0) {
        el.scrollTop += diff;
      }
    }
  }, [isLoadingOlderMessages, messages.length]);

  // Close on Escape key
  useEffect(() => {
    if (!isThreadPanelOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showOptionsMenu) {
          setShowOptionsMenu(false);
        } else {
          closeThread();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isThreadPanelOpen, closeThread, showOptionsMenu]);

  if (!isThreadPanelOpen) return null;

  // ── Header title: thread title or truncated parent message ──
  const headerTitle = activeThread
    ? activeThread.title || (parentMessage?.text ? parentMessage.text.slice(0, 50) + (parentMessage.text.length > 50 ? '...' : '') : `Thread`)
    : 'Thread';

  // ── Header content (shared between wide/narrow) ──
  const headerMeta = activeThread ? (
    <div className="flex items-center gap-3 text-[12px] text-text/50 dark:text-text-inv/50">
      {activeThread.status === 'archived' && (
        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
          <Archive size={11} />
          Archived
        </span>
      )}
      {activeThread.status === 'locked' && (
        <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-500/20 dark:text-red-400">
          <Lock size={11} />
          Locked
        </span>
      )}
      <span className="flex items-center gap-1">
        <MessageCircle size={12} />
        {activeThread.replyCount} {activeThread.replyCount === 1 ? 'reply' : 'replies'}
      </span>
      <span className="flex items-center gap-1">
        <Users size={12} />
        {activeThread.participantIds.length}
      </span>
      <ParticipantAvatars participantIds={activeThread.participantIds} />
    </div>
  ) : null;

  // ── Pinned parent message ──
  const parentMessageView = activeThread && parentMessage ? (
    <div className="border-b border-border/70 bg-slate-50/80 px-4 py-3 dark:border-border-dark/70 dark:bg-white/[0.03]">
      <div className="rounded-lg border-l-[3px] border-l-primary/60 bg-white py-2 pl-3 pr-3 shadow-sm dark:bg-surface-dark/80">
        {/* Sender row */}
        <div className="mb-1 flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-white shadow-sm ${
            parentMessage.sender === 'user'
              ? 'bg-gradient-to-br from-info to-accent'
              : 'bg-gradient-to-br from-primary to-primary-deep'
          }`}>
            <User size={12} />
          </div>
          <span className={`text-[13px] font-semibold ${
            parentMessage.sender === 'user' ? 'text-info' : 'text-primary'
          }`}>
            {parentMessage.sender === 'user' ? 'You' : 'Bot'}
          </span>
          {parentMessage.timestamp && (
            <span className="text-[10px] text-text/30 dark:text-text-inv/25 tabular-nums">
              {formatTime(parentMessage.timestamp)}
            </span>
          )}
        </div>
        {/* Message content */}
        <div className="text-[14px] leading-relaxed text-text dark:text-text-inv">
          {parentMessage.sender === 'user' ? (
            <span className="whitespace-pre-wrap break-words">{parentMessage.text}</span>
          ) : (
            <MarkdownRenderer content={parentMessage.text} />
          )}
        </div>
      </div>
    </div>
  ) : activeThread ? (
    // Parent message not found in cache — show minimal placeholder
    <div className="border-b border-border/70 bg-slate-50/80 px-4 py-3 dark:border-border-dark/70 dark:bg-white/[0.03]">
      <div className="rounded-lg border-l-[3px] border-l-primary/60 bg-white py-2 pl-3 pr-3 shadow-sm dark:bg-surface-dark/80">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-slate-300 to-slate-400 text-[10px] text-white shadow-sm">
            <User size={12} />
          </div>
          <span className="text-[13px] italic text-text/40 dark:text-text-inv/40">
            Original message
          </span>
        </div>
      </div>
    </div>
  ) : null;

  // ── No-op handlers for MessageItem (thread context — simplified interactions) ──
  const noop = () => {};
  const noopMsg = (_msg: unknown) => {};
  const noopStr = (_s: string) => {};
  const noopCopy = (_id: string, _text: string) => {};
  const noopReaction = (_msgId: string, _emoji: string, _hasIt: boolean) => {};
  const noopReactionRemove = (_msgId: string, _emoji: string) => {};

  // ── Body content: thread message list or empty/loading state ──
  const body = activeThreadId ? (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Scrollable message list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 py-2"
      >
        {/* Top sentinel for loading older messages */}
        <div ref={topSentinelRef} className="h-1" />

        {/* Loading older spinner */}
        {isLoadingOlderMessages && (
          <div className="flex justify-center py-3">
            <Loader2 size={20} className="animate-spin text-text/30 dark:text-text-inv/30" />
          </div>
        )}

        {/* No more messages indicator */}
        {!hasMoreMessages && messages.length > 0 && (
          <div className="flex justify-center py-2">
            <span className="text-[11px] text-text/30 dark:text-text-inv/25">Thread start</span>
          </div>
        )}

        {/* Initial loading state */}
        {isLoadingMessages && messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
            <Loader2 size={24} className="animate-spin text-primary/50" />
            <span className="text-[13px] text-text/40 dark:text-text-inv/40">Loading messages...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <MessageSquareText size={24} className="text-primary" />
            </div>
            <p className="text-center text-[13px] text-text/50 dark:text-text-inv/50">
              No replies yet
            </p>
          </div>
        ) : (
          /* Message list */
          messages.map((msg, i) => (
            <MessageItem
              key={msg.id}
              msg={msg}
              index={i}
              messages={messages}
              agentInfo={threadAgentInfo}
              copiedMsgId={null}
              runtimeConnId={connId || ''}
              onTouchStart={noopStr}
              onTouchEnd={noop}
              onRetry={noopMsg}
              onReply={noopMsg}
              onEdit={noopMsg}
              onDelete={noopStr}
              onCopy={noopCopy}
              onQuickSend={noopStr}
              onReactionToggle={noopReaction}
              onReactionRemove={noopReactionRemove}
              onOpenReactionPicker={noopStr}
            />
          ))
        )}

        {/* Bottom anchor for scrollToBottom */}
        <div ref={bottomRef} />
      </div>

      {/* "New messages" pill */}
      <AnimatePresence>
        {hasNewMessages && !isNearBottom && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            onClick={() => { scrollToBottom(true); setHasNewMessages(false); }}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-white shadow-lg transition-colors hover:bg-primary-deep"
          >
            <span className="flex items-center gap-1">
              <ArrowDown size={14} />
              New messages
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <MessageSquareText size={28} className="text-primary" />
      </div>
      <p className="text-center text-[14px] font-medium text-text/60 dark:text-text-inv/60">
        Select a message to view thread
      </p>
    </div>
  );

  // ── Wide screen: in-flow right sidebar ──
  if (isWide) {
    return (
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: 400, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="relative flex h-full flex-shrink-0 flex-col overflow-hidden border-l border-border/70 bg-white dark:border-border-dark/70 dark:bg-surface-dark"
      >
        {/* Header */}
        <div className="flex flex-col border-b border-border/70 px-4 py-3 dark:border-border-dark/70">
          <div className="flex items-center justify-between">
            <h3 className="flex-1 truncate text-[15px] font-semibold text-text dark:text-text-inv">
              {headerTitle}
            </h3>
            <div className="relative flex items-center gap-1" ref={optionsMenuAnchorRef}>
              {activeThread && (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowOptionsMenu(!showOptionsMenu)}
                  className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
                  title="Thread options"
                >
                  <MoreVertical size={16} />
                </motion.button>
              )}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={closeThread}
                className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
              >
                <X size={18} />
              </motion.button>
              <AnimatePresence>
                {showOptionsMenu && activeThread && (
                  <ThreadOptionsMenu
                    thread={activeThread}
                    onClose={() => setShowOptionsMenu(false)}
                    connectionId={connId}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
          {headerMeta && <div className="mt-1.5">{headerMeta}</div>}
        </div>

        {/* Pinned parent message */}
        {parentMessageView}

        {/* Body (thread messages) */}
        {body}

        {/* Input box — hidden for archived, locked message for locked */}
        {activeThreadId && activeThread?.status === 'locked' ? (
          <div className="border-t border-border/70 px-4 py-3 dark:border-border-dark/70">
            <div className="flex items-center justify-center gap-2 rounded-[16px] bg-slate-100/80 py-2.5 text-[13px] text-text/50 dark:bg-white/[0.04] dark:text-text-inv/40">
              <Lock size={14} />
              This thread is locked
            </div>
          </div>
        ) : activeThreadId && activeThread?.status !== 'archived' ? (
          <ThreadInput connId={connId} agentId={agentId} />
        ) : null}
      </motion.div>
    );
  }

  // ── Narrow screen: fullscreen overlay ──
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-surface-dark"
    >
      {/* Header with back button */}
      <div className="flex flex-col border-b border-border/70 px-3 py-3 dark:border-border-dark/70">
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={closeThread}
            className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
          >
            <ArrowLeft size={18} />
          </motion.button>
          <h3 className="flex-1 truncate text-[15px] font-semibold text-text dark:text-text-inv">
            {headerTitle}
          </h3>
          <div className="relative">
            {activeThread && (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowOptionsMenu(!showOptionsMenu)}
                className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
                title="Thread options"
              >
                <MoreVertical size={16} />
              </motion.button>
            )}
            <AnimatePresence>
              {showOptionsMenu && activeThread && (
                <ThreadOptionsMenu
                  thread={activeThread}
                  onClose={() => setShowOptionsMenu(false)}
                  connectionId={connId}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
        {headerMeta && <div className="mt-1.5 pl-12">{headerMeta}</div>}
      </div>

      {/* Pinned parent message */}
      {parentMessageView}

      {/* Body (thread messages) */}
      {body}

      {/* Input box — hidden for archived, locked message for locked */}
      {activeThreadId && activeThread?.status === 'locked' ? (
        <div className="border-t border-border/70 px-4 py-3 dark:border-border-dark/70">
          <div className="flex items-center justify-center gap-2 rounded-[16px] bg-slate-100/80 py-2.5 text-[13px] text-text/50 dark:bg-white/[0.04] dark:text-text-inv/40">
            <Lock size={14} />
            This thread is locked
          </div>
        </div>
      ) : activeThreadId && activeThread?.status !== 'archived' ? (
        <ThreadInput connId={connId} agentId={agentId} />
      ) : null}
    </motion.div>
  );
}

export const ThreadPanel = memo(ThreadPanelInner);
