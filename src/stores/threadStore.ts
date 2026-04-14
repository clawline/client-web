import { create } from 'zustand';
import * as channel from '../services/clawChannel';
import type { InboundPacket } from '../services/clawChannel';
import type { Message } from '../components/chat/types';

// ── Thread types (mirrored from channel/src/generic/thread-types.ts) ──

export type ThreadStatus = 'active' | 'archived' | 'locked' | 'deleted';
export type ThreadType = 'user' | 'acp';

export interface Thread {
  id: string;
  channelId: string;
  parentMessageId: string;
  creatorId: string;
  title: string | null;
  status: ThreadStatus;
  type: ThreadType;
  createdAt: string;
  updatedAt: string;
  lastReplyAt: string | null;
  replyCount: number;
  participantIds: string[];
}

export interface ThreadReadStatus {
  userId: string;
  threadId: string;
  lastReadAt: string;
  lastReadMessageId: string | null;
}

export interface ThreadListFilter {
  channelId: string;
  status?: ThreadStatus | 'all';
  participantId?: string;
  page: number;
  pageSize: number;
}

// ── Store state & actions ──

interface ThreadState {
  /** All known threads keyed by thread ID */
  threads: Map<string, Thread>;
  /** Currently open thread ID */
  activeThreadId: string | null;
  /** Messages per thread keyed by thread ID */
  threadMessages: Map<string, Message[]>;
  /** Per-user read status keyed by thread ID */
  threadReadStatus: Map<string, ThreadReadStatus>;
  /** Current list filter for thread list view */
  threadListFilter: ThreadListFilter;
  /** Whether the thread panel is open */
  isThreadPanelOpen: boolean;
  /** Total thread count from last list query (for pagination) */
  threadListTotal: number;
  /** Loading state for thread list */
  isLoadingThreadList: boolean;
  /** Loading state for thread messages */
  isLoadingMessages: boolean;
  /** Loading state for older messages (scroll-up pagination) */
  isLoadingOlderMessages: boolean;
  /** Whether the current thread has more older messages to load */
  hasMoreMessages: boolean;

  // ── Actions ──
  createThread: (parentMessageId: string, title?: string, connectionId?: string) => void;
  openThread: (threadId: string, connectionId?: string) => void;
  closeThread: () => void;
  setActiveThread: (threadId: string | null) => void;
  loadThreadList: (filter?: Partial<ThreadListFilter>, connectionId?: string) => void;
  loadThreadMessages: (threadId: string, opts?: { before?: number; limit?: number }, connectionId?: string) => void;
  loadOlderMessages: (connectionId?: string) => void;
  sendThreadMessage: (content: string, agentId?: string, connectionId?: string) => void;
  markThreadRead: (threadId: string, connectionId?: string) => void;
  updateThread: (threadId: string, payload: { title?: string; status?: ThreadStatus }, connectionId?: string) => void;
  deleteThread: (threadId: string, connectionId?: string) => void;

  // ── WebSocket event handlers (called from listener) ──
  onThreadUpdated: (thread: Thread) => void;
  onThreadNewReply: (data: { threadId: string; messageId: string; senderId: string; preview: string }) => void;

  // ── Internal helpers ──
  _setThread: (thread: Thread) => void;
  _appendMessage: (threadId: string, msg: Message) => void;
  _setMessages: (threadId: string, msgs: Message[], prepend?: boolean) => void;
}

export const useThreadStore = create<ThreadState>()((set, get) => ({
  threads: new Map(),
  activeThreadId: null,
  threadMessages: new Map(),
  threadReadStatus: new Map(),
  threadListFilter: { channelId: '', status: 'all', page: 1, pageSize: 20 },
  isThreadPanelOpen: false,
  threadListTotal: 0,
  isLoadingThreadList: false,
  isLoadingMessages: false,
  isLoadingOlderMessages: false,
  hasMoreMessages: true,

  // ── Actions ──

  createThread(parentMessageId, title, connectionId) {
    const requestId = `thread-create-${Date.now()}`;
    channel.sendRaw({
      type: 'thread.create',
      data: { requestId, parentMessageId, title: title || undefined },
    }, connectionId);
    // Response handled by onThreadUpdated via WS broadcast
  },

  openThread(threadId, connectionId) {
    const requestId = `thread-get-${Date.now()}`;
    set({ activeThreadId: threadId, isThreadPanelOpen: true, isLoadingMessages: true, hasMoreMessages: true });

    channel.sendRaw({
      type: 'thread.get',
      data: { requestId, threadId },
    }, connectionId);
    // Response handled by the WS listener that processes thread.get responses
  },

  closeThread() {
    set({ activeThreadId: null, isThreadPanelOpen: false });
  },

  setActiveThread(threadId) {
    set({ activeThreadId: threadId, isThreadPanelOpen: threadId !== null });
  },

  loadThreadList(filter, connectionId) {
    const state = get();
    const mergedFilter = { ...state.threadListFilter, ...filter };
    set({ threadListFilter: mergedFilter, isLoadingThreadList: true });

    const requestId = `thread-list-${Date.now()}`;
    channel.sendRaw({
      type: 'thread.list',
      data: {
        requestId,
        channelId: mergedFilter.channelId,
        status: mergedFilter.status,
        participantId: mergedFilter.participantId,
        page: mergedFilter.page,
        pageSize: mergedFilter.pageSize,
      },
    }, connectionId);
    // Response handled by the WS listener
  },

  loadThreadMessages(threadId, opts, connectionId) {
    set({ isLoadingMessages: true });

    const requestId = `thread-msgs-${Date.now()}`;
    channel.sendRaw({
      type: 'thread.get',
      data: { requestId, threadId, ...(opts || {}) },
    }, connectionId);
  },

  loadOlderMessages(connectionId) {
    const { activeThreadId, threadMessages, isLoadingOlderMessages, hasMoreMessages } = get();
    if (!activeThreadId || isLoadingOlderMessages || !hasMoreMessages) return;

    const msgs = threadMessages.get(activeThreadId) ?? [];
    if (msgs.length === 0) return;

    // Use the oldest message's timestamp as the `before` cursor
    const oldestTimestamp = msgs[0].timestamp;
    if (!oldestTimestamp) return;

    set({ isLoadingOlderMessages: true });

    const requestId = `thread-older-${Date.now()}`;
    channel.sendRaw({
      type: 'thread.get',
      data: { requestId, threadId: activeThreadId, before: oldestTimestamp, limit: 50 },
    }, connectionId);
  },

  sendThreadMessage(content, agentId, connectionId) {
    const { activeThreadId } = get();
    if (!activeThreadId) return;

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = Date.now();

    // Send via sendRaw with threadId included in the payload
    channel.sendRaw({
      type: 'message.receive',
      data: {
        messageId,
        chatId: channel.getChatId(connectionId),
        chatType: 'direct',
        senderId: channel.getSenderId(connectionId),
        senderName: '',
        messageType: 'text',
        content,
        timestamp,
        threadId: activeThreadId,
        ...(agentId || channel.getCurrentAgentId(connectionId)
          ? { agentId: agentId || channel.getCurrentAgentId(connectionId) }
          : {}),
      },
    }, connectionId);

    // Optimistic update: append to thread messages immediately
    const optimisticMsg: Message = {
      id: messageId,
      sender: 'user',
      text: content,
      timestamp,
      threadId: activeThreadId,
      deliveryStatus: 'pending',
    };
    get()._appendMessage(activeThreadId, optimisticMsg);
  },

  markThreadRead(threadId, connectionId) {
    channel.sendRaw({
      type: 'thread.mark_read',
      data: { threadId },
    }, connectionId);

    // Optimistic: clear unread for this thread
    set((state) => {
      const newReadStatus = new Map(state.threadReadStatus);
      const existing = newReadStatus.get(threadId);
      newReadStatus.set(threadId, {
        userId: existing?.userId ?? '',
        threadId,
        lastReadAt: new Date().toISOString(),
        lastReadMessageId: existing?.lastReadMessageId ?? null,
      });
      return { threadReadStatus: newReadStatus };
    });
  },

  updateThread(threadId, payload, connectionId) {
    const requestId = `thread-update-${Date.now()}`;
    channel.sendRaw({
      type: 'thread.update',
      data: { requestId, threadId, ...payload },
    }, connectionId);
  },

  deleteThread(threadId, connectionId) {
    const requestId = `thread-delete-${Date.now()}`;
    channel.sendRaw({
      type: 'thread.delete',
      data: { requestId, threadId },
    }, connectionId);
  },

  // ── WebSocket event handlers ──

  onThreadUpdated(thread) {
    set((state) => {
      const newThreads = new Map(state.threads);
      newThreads.set(thread.id, thread);

      // If the active thread was deleted, close the panel
      const shouldClose = state.activeThreadId === thread.id && thread.status === 'deleted';

      return {
        threads: newThreads,
        ...(shouldClose ? { activeThreadId: null, isThreadPanelOpen: false } : {}),
      };
    });
  },

  onThreadNewReply(data) {
    const state = get();
    const thread = state.threads.get(data.threadId);
    if (!thread) return;

    // Update thread metadata (increment reply count)
    const updatedThread: Thread = {
      ...thread,
      replyCount: thread.replyCount + 1,
      lastReplyAt: new Date().toISOString(),
      participantIds: thread.participantIds.includes(data.senderId)
        ? thread.participantIds
        : [...thread.participantIds, data.senderId],
    };
    get()._setThread(updatedThread);
  },

  // ── Internal helpers ──

  _setThread(thread) {
    set((state) => {
      const newThreads = new Map(state.threads);
      newThreads.set(thread.id, thread);
      return { threads: newThreads };
    });
  },

  _appendMessage(threadId, msg) {
    set((state) => {
      const newMessages = new Map(state.threadMessages);
      const existing = newMessages.get(threadId) ?? [];
      // Deduplicate by message ID
      if (existing.some((m) => m.id === msg.id)) return state;
      newMessages.set(threadId, [...existing, msg]);
      return { threadMessages: newMessages };
    });
  },

  _setMessages(threadId, msgs, prepend = false) {
    set((state) => {
      const newMessages = new Map(state.threadMessages);
      const existing = newMessages.get(threadId) ?? [];
      if (prepend) {
        // Prepend older messages, deduplicating
        const existingIds = new Set(existing.map((m) => m.id));
        const unique = msgs.filter((m) => !existingIds.has(m.id));
        newMessages.set(threadId, [...unique, ...existing]);
      } else {
        newMessages.set(threadId, msgs);
      }
      return { threadMessages: newMessages };
    });
  },
}));

// ── WebSocket listener for thread events ──

/**
 * Register thread-related WebSocket event listeners on a connection.
 * Returns an unsubscribe function.
 */
export function subscribeThreadEvents(connectionId?: string): () => void {
  const handlePacket = (packet: InboundPacket) => {
    const store = useThreadStore.getState();
    const data = packet.data as Record<string, unknown>;

    switch (packet.type) {
      case 'thread.updated': {
        const thread = data.thread as Thread | undefined;
        if (thread) {
          store.onThreadUpdated(thread);
        }
        break;
      }

      case 'thread.new_reply': {
        const replyData = data as { threadId: string; messageId: string; senderId: string; preview: string };
        if (replyData.threadId) {
          store.onThreadNewReply(replyData);
        }
        break;
      }

      case 'thread.create': {
        // Response to our thread.create request
        const thread = data.thread as Thread | undefined;
        if (thread) {
          store.onThreadUpdated(thread);
          // Auto-open the created thread
          useThreadStore.setState({ activeThreadId: thread.id, isThreadPanelOpen: true });
        }
        break;
      }

      case 'thread.get': {
        // Response to thread.get request
        const thread = data.thread as Thread | undefined;
        const messages = data.messages as Array<{
          id: string;
          messageId?: string;
          content?: string;
          senderId?: string;
          direction?: string;
          timestamp?: number;
          threadId?: string;
        }> | undefined;
        const unreadCount = data.unreadCount as number | undefined;

        if (thread) {
          store.onThreadUpdated(thread);

          // Store unread status
          if (typeof unreadCount === 'number') {
            useThreadStore.setState((state) => {
              const newReadStatus = new Map(state.threadReadStatus);
              const existing = newReadStatus.get(thread.id);
              newReadStatus.set(thread.id, {
                userId: existing?.userId ?? '',
                threadId: thread.id,
                lastReadAt: existing?.lastReadAt ?? '',
                lastReadMessageId: existing?.lastReadMessageId ?? null,
              });
              return { threadReadStatus: newReadStatus };
            });
          }

          // Store messages if present
          if (messages && messages.length > 0) {
            const mapped: Message[] = messages.map((m) => ({
              id: m.messageId || m.id,
              sender: (m.direction === 'outbound' ? 'ai' : 'user') as 'user' | 'ai',
              text: m.content || '',
              timestamp: m.timestamp,
              threadId: m.threadId || thread.id,
            }));

            const currentState = useThreadStore.getState();
            if (currentState.isLoadingOlderMessages) {
              // Pagination: prepend older messages
              store._setMessages(thread.id, mapped, true);
              // If fewer messages returned than expected, no more to load
              useThreadStore.setState({
                isLoadingOlderMessages: false,
                hasMoreMessages: mapped.length >= 20,
              });
            } else {
              // Initial load: replace messages
              store._setMessages(thread.id, mapped);
            }
          } else if (useThreadStore.getState().isLoadingOlderMessages) {
            // No messages returned during pagination — no more older messages
            useThreadStore.setState({ isLoadingOlderMessages: false, hasMoreMessages: false });
          }

          useThreadStore.setState({ isLoadingMessages: false });
        }
        break;
      }

      case 'thread.list': {
        // Response to thread.list request
        const threads = data.threads as Array<Thread & { unreadCount: number }> | undefined;
        const total = data.total as number | undefined;

        if (threads) {
          useThreadStore.setState((state) => {
            const newThreads = new Map(state.threads);
            const newReadStatus = new Map(state.threadReadStatus);

            for (const t of threads) {
              newThreads.set(t.id, t);
              // Track unread counts (store as pseudo-read-status for access)
              if (typeof t.unreadCount === 'number' && t.unreadCount > 0) {
                const existing = newReadStatus.get(t.id);
                newReadStatus.set(t.id, {
                  userId: existing?.userId ?? '',
                  threadId: t.id,
                  lastReadAt: existing?.lastReadAt ?? '',
                  lastReadMessageId: existing?.lastReadMessageId ?? null,
                });
              }
            }

            return {
              threads: newThreads,
              threadReadStatus: newReadStatus,
              threadListTotal: total ?? threads.length,
              isLoadingThreadList: false,
            };
          });
        } else {
          useThreadStore.setState({ isLoadingThreadList: false });
        }
        break;
      }

      case 'thread.update':
      case 'thread.delete': {
        // Responses to our update/delete requests — thread.updated broadcast handles the state update
        const thread = data.thread as Thread | undefined;
        if (thread) {
          store.onThreadUpdated(thread);
        }
        break;
      }

      // Handle incoming thread messages from the main message flow
      default: {
        if (
          (packet.type === 'message.send' || packet.type === 'message.receive') &&
          data.threadId
        ) {
          const threadId = data.threadId as string;
          const msg: Message = {
            id: (data.messageId as string) || `msg-${Date.now()}`,
            sender: packet.type === 'message.send' ? 'ai' : 'user',
            text: (data.content as string) || '',
            timestamp: (data.timestamp as number) || Date.now(),
            threadId,
          };
          store._appendMessage(threadId, msg);
        }
        break;
      }
    }
  };

  return channel.onMessage(handlePacket, connectionId);
}
