import { motion } from 'motion/react';

/**
 * Generic slash-command response card renderer.
 *
 * Detects messages that look like structured command output:
 *   - Multiple "emoji Key: value" rows (e.g. /status, /context, /whoami)
 *
 * When detected, renders as a clean card instead of raw text.
 */

type CardRow = {
  emoji: string;
  label: string;
  value: string;
};

type ParsedCard = {
  title?: string;
  rows: CardRow[];
};

// Emoji pattern: standard emoji (with optional variation selectors and ZWJ sequences)
const E = String.raw`[\p{Emoji_Presentation}\p{Extended_Pictographic}][\u{FE0E}\u{FE0F}\u{200D}\p{Emoji_Presentation}\p{Extended_Pictographic}]*`;

function parseSlashResponse(text: string): ParsedCard | null {
  // Split into emoji-prefixed segments
  const segRe = new RegExp(`(${E})\\s*`, 'gu');
  const segments: { emoji: string; body: string; start: number }[] = [];

  let lastIdx = 0;
  let m;
  while ((m = segRe.exec(text)) !== null) {
    if (segments.length > 0) {
      segments[segments.length - 1].body = text.slice(segments[segments.length - 1].start, m.index).trim();
    }
    segments.push({ emoji: m[1], body: '', start: m.index + m[0].length });
    lastIdx = m.index + m[0].length;
  }
  if (segments.length > 0) {
    segments[segments.length - 1].body = text.slice(lastIdx).trim();
  }

  if (segments.length < 3) return null;

  // Parse each segment: if body contains "Label: Value", it's a row; otherwise title/header
  let title: string | undefined;
  const rows: CardRow[] = [];

  for (const seg of segments) {
    // Match "Label: Value" — first colon that isn't inside parentheses
    const colonIdx = findLabelColon(seg.body);
    if (colonIdx > 0 && colonIdx < 30) {
      const label = seg.body.slice(0, colonIdx).trim();
      const value = seg.body.slice(colonIdx + 1).trim().replace(/[·•]\s*$/, '').trim();
      if (label && value) {
        rows.push({ emoji: seg.emoji, label, value });
        continue;
      }
    }
    // Non-KV segment — use first one as title
    if (!title && seg.body) {
      title = `${seg.emoji} ${seg.body}`;
    }
  }

  if (rows.length < 3) return null;

  return { title, rows };
}

/** Find the first colon that's not inside parentheses */
function findLabelColon(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth = Math.max(0, depth - 1);
    else if ((s[i] === ':' || s[i] === '：') && depth === 0) return i;
  }
  return -1;
}

// Highlight badges like "100%", "4%", version strings, model names
function formatValue(value: string) {
  const parts = value.split(/([·•])/g);
  return parts.map((part, i) => {
    const trimmed = part.trim();
    if (['·', '•'].includes(trimmed)) {
      return <span key={i} className="mx-1 text-text/20 dark:text-text-inv/20">·</span>;
    }
    const pctMatch = trimmed.match(/(\d+%)/);
    if (pctMatch) {
      const pct = parseInt(pctMatch[1]);
      const color = pct >= 80 ? 'text-emerald-500' : pct >= 40 ? 'text-amber-500' : 'text-red-500';
      return (
        <span key={i}>
          {trimmed.replace(pctMatch[1], '')}
          <span className={`font-semibold ${color}`}>{pctMatch[1]}</span>
        </span>
      );
    }
    return <span key={i}>{trimmed}</span>;
  });
}

type Props = {
  text: string;
};

export default function SlashResponseCard({ text }: Props) {
  const parsed = parseSlashResponse(text);
  if (!parsed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden rounded-xl border border-border bg-primary/10 dark:border-border-dark dark:bg-primary/10"
    >
      {parsed.title && (
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5 text-[13px] font-semibold text-text dark:text-text-inv">
          <span className="h-4 w-0.5 rounded-full bg-primary" />
          <span>{parsed.title}</span>
        </div>
      )}
      <div className="divide-y divide-border/30 dark:divide-border-dark/30">
        {parsed.rows.map((row, i) => (
          <div
            key={i}
            className={`flex items-start gap-2.5 px-3.5 py-1.5 ${!parsed.title && i === 0 ? 'pt-3' : ''} ${i === parsed.rows.length - 1 ? 'pb-3' : ''}`}
          >
            <span className="mt-0.5 w-5 shrink-0 text-center text-[14px]">{row.emoji}</span>
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-text/40 dark:text-text-inv/35">
                {row.label}
              </span>
              <div className="mt-0.5 break-words text-[13px] leading-snug text-text dark:text-text-inv">
                {formatValue(row.value)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export { parseSlashResponse };
