import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Check, Cpu, Sparkles } from 'lucide-react';

// Provider display names and order
const PROVIDER_DISPLAY: Record<string, { label: string; emoji: string }> = {
  'anthropic': { label: 'Anthropic', emoji: '🟤' },
  'openai': { label: 'OpenAI', emoji: '🟢' },
  'github-copilot': { label: 'GitHub Copilot', emoji: '🐙' },
  'google': { label: 'Google', emoji: '🔵' },
  'openrouter': { label: 'OpenRouter', emoji: '🔀' },
  'mistral': { label: 'Mistral', emoji: '🟠' },
  'groq': { label: 'Groq', emoji: '⚡' },
  'deepseek': { label: 'DeepSeek', emoji: '🔷' },
  'xai': { label: 'xAI', emoji: '✖️' },
  'ollama': { label: 'Ollama', emoji: '🦙' },
  'clawfood': { label: 'Clawfood', emoji: '🦞' },
  'amazon-bedrock': { label: 'Bedrock', emoji: '🪨' },
  'azure': { label: 'Azure', emoji: '☁️' },
};

function getProviderDisplay(provider: string) {
  return PROVIDER_DISPLAY[provider] || { label: provider, emoji: '🤖' };
}

/** Shorten model id for display: remove redundant provider prefix */
function shortModelName(model: string, modelNames?: Record<string, string>): string {
  // Use human-readable name if available
  const fullKey = model; // model is already just the model part
  if (modelNames?.[fullKey]) return modelNames[fullKey];
  // Remove common prefixes and suffixes
  return model
    .replace(/^(models|accounts)\/[^/]+\//, '') // Google-style paths
    .replace(/:.*$/, ''); // version suffixes
}

export type ModelsData = {
  models: Record<string, string[]>; // provider → model[]
  modelNames: Record<string, string>; // "provider/model" → display name
  defaultModel?: string;
  currentModel?: string;
};

type Props = {
  currentModel?: string; // "provider/model"
  onRequestModels: () => void;
  onSwitchModel: (model: string) => void;
  modelsData: ModelsData | null;
  isLoading?: boolean;
};

export default function ModelPicker({ currentModel, onRequestModels, onSwitchModel, modelsData, isLoading }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse current model into provider/model
  const currentProvider = currentModel?.split('/')[0];
  const currentModelId = currentModel?.split('/').slice(1).join('/');

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setExpandedProvider(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleOpen = useCallback(() => {
    if (!modelsData) {
      onRequestModels();
    }
    setIsOpen(!isOpen);
    if (!isOpen && currentProvider) {
      setExpandedProvider(currentProvider);
    }
  }, [isOpen, modelsData, onRequestModels, currentProvider]);

  const handleSelectModel = useCallback((provider: string, model: string) => {
    const fullModel = `${provider}/${model}`;
    if (fullModel !== currentModel) {
      onSwitchModel(fullModel);
    }
    setIsOpen(false);
    setExpandedProvider(null);
  }, [currentModel, onSwitchModel]);

  // Display label for the button
  const displayLabel = currentModel
    ? shortModelName(currentModelId || '', modelsData?.modelNames)
    : 'Model';

  const providers = modelsData ? Object.keys(modelsData.models).sort((a, b) => {
    // Put current provider first
    if (a === currentProvider) return -1;
    if (b === currentProvider) return 1;
    // Then by display order
    const ai = Object.keys(PROVIDER_DISPLAY).indexOf(a);
    const bi = Object.keys(PROVIDER_DISPLAY).indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  }) : [];

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={handleOpen}
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] transition-colors ${
          isOpen
            ? 'bg-primary/10 text-primary'
            : 'text-text/30 hover:text-text/55 hover:bg-text/[0.04] dark:text-text-inv/25 dark:hover:text-text-inv/45 dark:hover:bg-text-inv/[0.06]'
        }`}
      >
        <Sparkles size={10} className={isOpen ? 'text-primary' : ''} />
        <span className="max-w-[100px] truncate">{displayLabel}</span>
        <ChevronDown size={8} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => { setIsOpen(false); setExpandedProvider(null); }}
            />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-0 z-50 mb-2 w-[260px] max-h-[50vh] overflow-y-auto rounded-[16px] border border-border/70 bg-white/96 shadow-[0_24px_48px_-26px_rgba(15,23,42,0.36)] backdrop-blur-[20px] dark:border-border-dark/70 dark:bg-card-alt/96 dark:shadow-[0_24px_48px_-26px_rgba(2,6,23,0.78)]"
            >
              {isLoading || !modelsData ? (
                <div className="flex items-center justify-center py-6 text-[12px] text-slate-400">
                  <Cpu size={14} className="mr-2 animate-spin" />
                  Loading models…
                </div>
              ) : providers.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-slate-400">
                  No models available
                </div>
              ) : (
                <div className="py-1">
                  {providers.map((provider) => {
                    const models = modelsData.models[provider] || [];
                    const display = getProviderDisplay(provider);
                    const isExpanded = expandedProvider === provider;
                    const hasCurrentModel = provider === currentProvider;

                    return (
                      <div key={provider}>
                        {/* Provider header */}
                        <button
                          onClick={() => setExpandedProvider(isExpanded ? null : provider)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05] ${
                            hasCurrentModel ? 'bg-primary/[0.03]' : ''
                          }`}
                        >
                          <span className="w-5 shrink-0 text-center text-[13px]">{display.emoji}</span>
                          <span className="flex-1 text-[12px] font-medium text-text dark:text-text-inv">
                            {display.label}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">{models.length}</span>
                          {isExpanded ? (
                            <ChevronDown size={12} className="text-slate-400" />
                          ) : (
                            <ChevronRight size={12} className="text-slate-300" />
                          )}
                        </button>

                        {/* Model list */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="overflow-hidden"
                            >
                              {models.map((model) => {
                                const fullKey = `${provider}/${model}`;
                                const isActive = fullKey === currentModel;
                                const displayName = shortModelName(model, modelsData.modelNames);

                                return (
                                  <button
                                    key={model}
                                    onClick={() => handleSelectModel(provider, model)}
                                    className={`flex w-full items-center gap-2 py-1.5 pl-10 pr-3 text-left transition-colors ${
                                      isActive
                                        ? 'bg-primary/8 text-primary'
                                        : 'text-text/70 hover:bg-slate-50 dark:text-text-inv/70 dark:hover:bg-white/[0.05]'
                                    }`}
                                  >
                                    <span className="flex-1 min-w-0 truncate text-[11px]">
                                      {displayName}
                                    </span>
                                    {isActive && <Check size={12} className="shrink-0 text-primary" />}
                                  </button>
                                );
                              })}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
