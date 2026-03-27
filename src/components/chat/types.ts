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
  timestamp?: number;
  isStreaming?: boolean;
  deliveryStatus?: DeliveryStatus;
};

export type ToolCall = {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  startTime: number;
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
