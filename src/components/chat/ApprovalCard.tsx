import { useState } from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, Check, X, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import MarkdownRenderer from '../MarkdownRenderer';

export type ParsedApproval = {
  /** Short description of what triggered the approval (from the warning line) */
  reason: string;
  /** Approval code, e.g. "f2e20730" */
  code: string;
  /** Full code, e.g. "f2e20730-2ad0-45fd-ae75-5c9c0b3cc992" */
  fullCode: string;
  /** The shell command / script waiting for approval */
  pendingCommand: string;
  /** Host / CWD / expiry metadata line */
  meta: string;
};

/**
 * Parse an OpenClaw approval request message.
 *
 * Expected format (simplified):
 *   ⚠️ <reason>
 *   Approval required.
 *   Run:
 *   /approve <code> allow-once
 *   Pending command:
 *   <...command block...>
 *   Other options:
 *   /approve <code> allow-always
 *   /approve <code> deny
 *   Host: ... Full id: <fullCode>
 */
export function parseApprovalMessage(text: string): ParsedApproval | null {
  // Must contain "Approval required."
  if (!text.includes('Approval required.')) return null;

  // Extract reason — first non-empty line (after stripping emoji)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const reasonLine = lines[0] ?? '';
  const reason = reasonLine.replace(/^[⚠️🔴🟡⛔❗！]+\s*/u, '').trim();

  // Extract short approval code from "/approve <code> allow-once"
  const codeMatch = text.match(/\/approve\s+([a-f0-9]{6,})\s+allow-once/i);
  if (!codeMatch) return null;
  const code = codeMatch[1];

  // Full id
  const fullIdMatch = text.match(/Full id:\s*([a-f0-9-]{10,})/i);
  const fullCode = fullIdMatch ? fullIdMatch[1] : code;

  // Pending command — content between "Pending command:" and "Other options:" (or end)
  const pendingMatch = text.match(/Pending command:\s*\n([\s\S]*?)(?:\nOther options:|$)/i);
  const pendingCommand = pendingMatch ? pendingMatch[1].trim() : '';

  // Meta line — "Host: ..."
  const metaMatch = text.match(/(Host:[^\n]+)/i);
  const meta = metaMatch ? metaMatch[1].trim() : '';

  return { reason, code, fullCode, pendingCommand, meta };
}

type Props = {
  parsed: ParsedApproval;
  onSend: (text: string) => void;
};

export default function ApprovalCard({ parsed, onSend }: Props) {
  const [showCommand, setShowCommand] = useState(false);
  const [acted, setActed] = useState<'allow-once' | 'allow-always' | 'deny' | null>(null);

  const handle = (action: 'allow-once' | 'allow-always' | 'deny') => {
    setActed(action);
    onSend(`/approve ${parsed.code} ${action}`);
  };

  const isDone = acted !== null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-1 overflow-hidden rounded-2xl border border-amber-400/40 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-950/20"
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-2">
        <ShieldAlert
          size={17}
          className="mt-0.5 shrink-0 text-amber-500 dark:text-amber-400"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-amber-700 dark:text-amber-300 leading-snug">
            需要审批
          </p>
          <p className="mt-0.5 text-[12px] text-amber-600/80 dark:text-amber-400/70 leading-snug break-words">
            {parsed.reason}
          </p>
        </div>
      </div>

      {/* Pending command (collapsible) */}
      {parsed.pendingCommand && (
        <div className="mx-3 mb-2 overflow-hidden rounded-xl border border-amber-300/30 dark:border-amber-500/10 bg-black/5 dark:bg-black/30">
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-left"
            onClick={() => setShowCommand((v) => !v)}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600/60 dark:text-amber-400/50">
              待执行命令
            </span>
            {showCommand ? (
              <ChevronUp size={13} className="text-amber-500/60" />
            ) : (
              <ChevronDown size={13} className="text-amber-500/60" />
            )}
          </button>
          {showCommand && (
            <div className="border-t border-amber-300/20 dark:border-amber-500/10 px-3 pb-3 pt-2">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-text/70 dark:text-text-inv/60 font-mono">
                {parsed.pendingCommand}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!isDone ? (
        <div className="flex gap-2 px-3 pb-3">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => handle('allow-once')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2.5 text-[13px] font-semibold text-white shadow-sm active:bg-amber-600 hover:bg-amber-600 transition-colors"
          >
            <Check size={14} />
            允许一次
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => handle('allow-always')}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/40 bg-white/60 dark:bg-white/5 px-3 py-2.5 text-[13px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
          >
            <RefreshCw size={13} />
            始终允许
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => handle('deny')}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-red-300/40 bg-white/60 dark:bg-white/5 px-3 py-2.5 text-[13px] font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <X size={14} />
            拒绝
          </motion.button>
        </div>
      ) : (
        <div className="px-3 pb-3">
          <div
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium
              ${acted === 'deny'
                ? 'bg-red-100/60 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                : 'bg-emerald-100/60 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
              }`}
          >
            {acted === 'deny' ? <X size={14} /> : <Check size={14} />}
            {acted === 'allow-once' ? '已允许（一次）' : acted === 'allow-always' ? '已设为始终允许' : '已拒绝'}
          </div>
        </div>
      )}

      {/* Meta footer */}
      {parsed.meta && (
        <div className="border-t border-amber-300/20 dark:border-amber-500/10 px-4 py-2">
          <p className="text-[10px] text-amber-500/50 dark:text-amber-400/40 font-mono break-all">
            {parsed.meta}
          </p>
        </div>
      )}
    </motion.div>
  );
}
