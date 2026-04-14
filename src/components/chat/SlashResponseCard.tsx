import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Generic slash-command response card renderer.
 *
 * Detects messages that look like structured command output:
 *   - Multiple "emoji Key: value" rows (e.g. /status, /context, /whoami)
 *
 * Short values → horizontal layout (label | value side by side)
 * Long/markdown values → vertical layout (label on top, markdown body below)
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

  // Reject if overall text is too long — status cards are compact
  if (text.length > 800) return null;

  // Reject if labels are too long — real status labels are short keywords
  if (rows.some((r) => r.label.length > 20)) return null;

  // Reject if most rows have block (long/multi-line) values — that's prose, not a status card
  const blockCount = rows.filter((r) => isBlockValue(r.value)).length;
  if (blockCount > rows.length / 2) return null;

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

/** Determine if a value should use vertical (block) layout */
function isBlockValue(value: string): boolean {
  return (
    value.length > 80 ||
    value.includes('\n') ||
    /\*\*|__|\#{1,3}\s|```|\-\s/.test(value)
  );
}

// Clean up trailing ### markers used as separators in some formats
function cleanValue(value: string): string {
  return value.replace(/\s*###\s*$/, '').trim();
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
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 text-[12px] font-semibold text-text dark:text-text-inv">
          <span className="h-3.5 w-0.5 rounded-full bg-primary" />
          <span>{parsed.title}</span>
        </div>
      )}
      <div className="divide-y divide-border/30 dark:divide-border-dark/30">
        {parsed.rows.map((row, i) => {
          const isFirst = !parsed.title && i === 0;
          const isLast = i === parsed.rows.length - 1;
          const cleaned = cleanValue(row.value);
          const block = isBlockValue(cleaned);

          if (block) {
            // Vertical layout: label row + markdown body
            return (
              <div
                key={i}
                className={`px-3 ${isFirst ? 'pt-2.5' : 'pt-2'} ${isLast ? 'pb-2.5' : 'pb-2'}`}
              >
                {/* Label row */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-4 shrink-0 text-center text-[13px]">{row.emoji}</span>
                  <span className="text-[11px] font-semibold text-text/50 dark:text-text-inv/40 uppercase tracking-wide">
                    {row.label}
                  </span>
                </div>
                {/* Markdown value */}
                <div className="pl-6 text-[13px] leading-relaxed text-text dark:text-text-inv prose-sm">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="mb-1 last:mb-0 break-words">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      ul: ({ children }) => <ul className="mb-1 list-disc pl-4 space-y-0.5">{children}</ul>,
                      ol: ({ children }) => <ol className="mb-1 list-decimal pl-4 space-y-0.5">{children}</ol>,
                      li: ({ children }) => <li className="pl-0.5">{children}</li>,
                      h1: ({ children }) => <h1 className="font-bold text-[14px] mb-1">{children}</h1>,
                      h2: ({ children }) => <h2 className="font-bold text-[13px] mb-1">{children}</h2>,
                      h3: ({ children }) => <h3 className="font-semibold text-[12px] mb-0.5">{children}</h3>,
                      code: ({ children }) => (
                        <code className="rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-[12px] font-mono">
                          {children}
                        </code>
                      ),
                    }}
                  >
                    {cleaned}
                  </ReactMarkdown>
                </div>
              </div>
            );
          }

          // Horizontal layout (original): label | value side by side
          return (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-1 ${isFirst ? 'pt-2.5' : ''} ${isLast ? 'pb-2.5' : ''}`}
            >
              <span className="w-4 shrink-0 text-center text-[13px]">{row.emoji}</span>
              <span className="text-[11px] font-medium text-text/40 dark:text-text-inv/35 whitespace-nowrap">
                {row.label}
              </span>
              <span className="min-w-0 flex-1 break-words text-[12px] leading-snug text-text dark:text-text-inv">
                {formatValue(cleaned)}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

export { parseSlashResponse };
