/**
 * AI-powered suggestion service
 * Generates contextual follow-up questions based on recent conversation.
 *
 * Configuration: set API key in Profile settings or localStorage.
 * Key: openclaw.suggestionConfig = { endpoint, apiKey, model }
 *
 * Default endpoint: Azure Foundry (models.inference.ai.azure.com)
 */

let lastContextHash = '';
let lastSuggestions: string[] = [];
let pendingRequest: Promise<string[]> | null = null;

interface SuggestionConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

const DEFAULT_ENDPOINT = 'https://models.inference.ai.azure.com';
const DEFAULT_MODEL = 'gpt-4.1';

function getConfig(): SuggestionConfig | null {
  try {
    // Primary: structured config in localStorage
    const stored = localStorage.getItem('openclaw.suggestionConfig');
    if (stored) {
      const cfg = JSON.parse(stored);
      if (cfg.endpoint && cfg.apiKey) return cfg;
    }

    // Fallback: just an API key (use default endpoint)
    const key = localStorage.getItem('openclaw.suggestionApiKey');
    if (key) {
      return { endpoint: DEFAULT_ENDPOINT, apiKey: key, model: DEFAULT_MODEL };
    }
  } catch { /* ignore */ }
  return null;
}

function hashContext(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return String(h);
}

interface ConversationMessage {
  role: 'user' | 'ai';
  text: string;
}

function buildContext(messages: ConversationMessage[]): string {
  const recent = messages.slice(-6);
  return recent
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text.slice(0, 300)}`)
    .join('\n');
}

const SYSTEM_PROMPT = `You are a suggestion generator for a chat interface. Based on the conversation context, generate 3-5 short follow-up questions or prompts the user might want to ask next.

Rules:
- Each suggestion must be under 25 characters (Chinese or English)
- Make suggestions relevant and diverse
- Mix between clarifying questions, deeper exploration, and action requests
- Output ONLY a JSON array of strings, nothing else
- If the conversation is in Chinese, generate Chinese suggestions
- If in English, generate English suggestions
- Match the language and tone of the conversation`;

async function fetchSuggestions(context: string, signal?: AbortSignal): Promise<string[]> {
  const config = getConfig();
  if (!config) return [];

  const isAzureOpenAI = config.endpoint.includes('.openai.azure.com');
  let url: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (isAzureOpenAI) {
    const base = config.endpoint.replace(/\/+$/, '').replace(/\/openai\/v1$/, '').replace(/\/openai$/, '');
    url = `${base}/openai/deployments/${config.model}/chat/completions?api-version=2025-01-01-preview`;
    headers['api-key'] = config.apiKey;
  } else {
    url = `${config.endpoint.replace(/\/+$/, '')}/chat/completions`;
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...(isAzureOpenAI ? {} : { model: config.model }),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Recent conversation:\n${context}\n\nGenerate 3-5 follow-up suggestions:` },
      ],
      temperature: 0.8,
      max_tokens: 200,
    }),
    signal,
  });

  if (!res.ok) {
    console.warn('[suggestions] API error:', res.status);
    return [];
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0).slice(0, 5);
    }
  } catch {
    const match = content.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return parsed.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0).slice(0, 5);
        }
      } catch { /* ignore */ }
    }
  }

  return [];
}

export async function getSuggestions(
  messages: { sender: string; text?: string }[],
  signal?: AbortSignal,
): Promise<string[]> {
  const conversationMsgs: ConversationMessage[] = messages
    .filter(m => m.text && m.text.length > 0)
    .map(m => ({
      role: m.sender === 'user' ? 'user' as const : 'ai' as const,
      text: m.text!,
    }));

  if (conversationMsgs.length === 0) return [];

  const context = buildContext(conversationMsgs);
  const hash = hashContext(context);

  if (hash === lastContextHash && lastSuggestions.length > 0) {
    return lastSuggestions;
  }

  if (pendingRequest) return pendingRequest;

  pendingRequest = fetchSuggestions(context, signal)
    .then(suggestions => {
      if (suggestions.length > 0) {
        lastContextHash = hash;
        lastSuggestions = suggestions;
      }
      return suggestions;
    })
    .catch(() => [] as string[])
    .finally(() => { pendingRequest = null; });

  return pendingRequest;
}

export function isSuggestionServiceAvailable(): boolean {
  return getConfig() !== null;
}

export function clearSuggestionCache(): void {
  lastContextHash = '';
  lastSuggestions = [];
  pendingRequest = null;
}

/**
 * Configure the suggestion service at runtime (stores in localStorage)
 */
export function configureSuggestionService(config: Partial<SuggestionConfig>): void {
  const current = getConfig() || { endpoint: DEFAULT_ENDPOINT, apiKey: '', model: DEFAULT_MODEL };
  const merged = { ...current, ...config };
  localStorage.setItem('openclaw.suggestionConfig', JSON.stringify(merged));
  clearSuggestionCache();
}
