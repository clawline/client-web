import type { LucideIcon } from 'lucide-react';

// Re-export AgentInfo from the canonical source
export type { AgentInfo } from '../../services/clawChannel';

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read';

export type Message = {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  reactions?: string[];
  mediaType?: string;
  mediaUrl?: string;
  replyTo?: string;
  quotedText?: string;
  timestamp?: number;
  isStreaming?: boolean;
  streamingDone?: boolean;
  deliveryStatus?: DeliveryStatus;
  threadId?: string;
  /** Optional metadata. meta.source="api" marks messages sent via POST /api/chat direct endpoint. */
  meta?: Record<string, unknown>;
};

export type ToolCall = {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  startTime: number;
  completed?: boolean;
  resultSummary?: string;
  endTime?: number;
};

export type SlashCommand = {
  id: string;
  icon: LucideIcon;
  label: string;
  desc: string;
};

export type QuickCommand = {
  label: string;
  emoji: string;
  desc: string;
};

export type ContextSuggestion = {
  label: string;
  emoji: string;
};
