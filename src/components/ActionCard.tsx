import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown } from 'lucide-react';

type ActionCardProps = {
  text: string;
  onSend: (text: string) => void;
};

type DetectedAction = {
  type: 'providers' | 'model-list' | 'think-levels' | 'quick-actions';
  title: string;
  options: { label: string; command: string; emoji?: string; badge?: string }[];
};

function detectActions(text: string): DetectedAction | null {
  const lower = text.toLowerCase();

  // Detect /models provider list:  "provider-name (123)" or "- provider-name (123)"
  const providerPatterns = [
    /^\s*([\w][\w-]*)\s+\((\d+)\)\s*$/gm,           // plain: amazon-bedrock (83)
    /^\s*[-*•]\s*([\w][\w-]*)\s+\((\d+)\)\s*$/gm,   // bullet: - amazon-bedrock (83)
    /^\s*\*{0,2}([\w][\w-]*)\*{0,2}\s+\((\d+)\)/gm, // bold: **amazon-bedrock** (83)
  ];
  const providers: { label: string; command: string; badge: string }[] = [];
  const seen = new Set<string>();
  for (const pattern of providerPatterns) {
    let pm;
    while ((pm = pattern.exec(text)) !== null) {
      if (!seen.has(pm[1])) {
        seen.add(pm[1]);
        providers.push({
          label: pm[1],
          command: `/models ${pm[1]}`,
          badge: pm[2],
        });
      }
    }
  }
  if (providers.length >= 2) {
    return { type: 'providers', title: 'Providers — tap to browse models', options: providers };
  }

  // Detect model list for a specific provider (lines like "  model-name")
  // Usually after /models <provider>, response lists model names
  if (lower.includes('/model ') && lower.includes('switch')) {
    const modelLines = text.match(/^[-•*]\s*`?(\S+\/\S+)`?/gm) || [];
    const modelNames = text.match(/`([^`]+\/[^`]+)`/g) || [];
    const allModels = new Set<string>();

    for (const line of modelLines) {
      const m = line.match(/`?(\S+\/\S+)`?/);
      if (m) allModels.add(m[1]);
    }
    for (const m of modelNames) {
      const clean = m.replace(/`/g, '');
      if (clean.includes('/') && !clean.startsWith('http')) allModels.add(clean);
    }

    if (allModels.size >= 1) {
      return {
        type: 'model-list',
        title: 'Switch Model',
        options: Array.from(allModels).slice(0, 20).map((m) => ({
          label: m.split('/').pop() || m,
          command: `/model ${m}`,
          emoji: '🤖',
        })),
      };
    }
  }

  // Detect individual model names in general responses (switch/current/active)
  if (lower.includes('model') && (lower.includes('available') || lower.includes('current') || lower.includes('active'))) {
    const models = new Set<string>();
    const patterns = [/`([^`]+\/[^`]+)`/g, /[-•]\s*\*{0,2}(\S+\/\S+)/g];
    for (const p of patterns) {
      let m;
      while ((m = p.exec(text)) !== null) {
        const val = m[1].trim();
        if (val.includes('/') && !val.startsWith('http') && val.length > 3) models.add(val);
      }
    }
    if (models.size >= 1) {
      return {
        type: 'model-list',
        title: 'Switch Model',
        options: Array.from(models).slice(0, 20).map((m) => ({
          label: m.split('/').pop() || m,
          command: `/model ${m}`,
          emoji: '🤖',
        })),
      };
    }
  }

  // Detect think/reasoning level responses
  if ((lower.includes('think') || lower.includes('reasoning')) && (lower.includes('level') || lower.includes('budget') || lower.includes('low') || lower.includes('high'))) {
    return {
      type: 'think-levels',
      title: 'Reasoning Level',
      options: [
        { label: 'Off', command: '/think off', emoji: '⚡' },
        { label: 'Low', command: '/think low', emoji: '💡' },
        { label: 'Medium', command: '/think medium', emoji: '🧠' },
        { label: 'High', command: '/think high', emoji: '🔬' },
      ],
    };
  }

  // Detect command list responses
  if ((lower.includes('/help') || lower.includes('/commands')) && lower.includes('/model') && lower.includes('/status')) {
    return {
      type: 'quick-actions',
      title: 'Quick Actions',
      options: [
        { label: 'Status', command: '/status', emoji: '📊' },
        { label: 'Models', command: '/models', emoji: '🤖' },
        { label: 'New Session', command: '/new', emoji: '✨' },
        { label: 'Reset', command: '/reset', emoji: '🔄' },
      ],
    };
  }

  return null;
}

export default function ActionCard({ text, onSend }: ActionCardProps) {
  const action = detectActions(text);
  const [expanded, setExpanded] = useState(false);
  if (!action) return null;

  const COLLAPSE_THRESHOLD = 8;
  const shouldCollapse = action.options.length > COLLAPSE_THRESHOLD;
  const visibleOptions = shouldCollapse && !expanded
    ? action.options.slice(0, COLLAPSE_THRESHOLD)
    : action.options;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-[16px] p-3"
    >
      <p className="text-[12px] font-semibold text-text/50 dark:text-text-inv/50 uppercase tracking-wider mb-2">
        {action.title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {visibleOptions.map((opt) => (
            <motion.button
              key={opt.command}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onSend(opt.command)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-full text-[13px] font-medium text-text dark:text-text-inv shadow-sm hover:border-primary hover:text-primary active:bg-primary/5 transition-colors min-h-[36px]"
            >
              {opt.emoji && <span>{opt.emoji}</span>}
              {opt.label}
              {opt.badge && (
                <span className="text-[11px] text-text/40 dark:text-text-inv/40 font-normal">({opt.badge})</span>
              )}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
      {shouldCollapse && (
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-[12px] text-primary font-medium"
        >
          <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Show less' : `Show all ${action.options.length} providers`}
        </motion.button>
      )}
    </motion.div>
  );
}
