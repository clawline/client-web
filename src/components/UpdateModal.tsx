import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  UPDATE_AVAILABLE_EVENT,
  performUpdate,
  clearPendingUpdate,
  type UpdateAvailableDetail,
} from '../services/tauri';

type Status = 'idle' | 'prompt' | 'downloading' | 'done' | 'error';

interface DownloadState {
  downloaded: number;
  contentLength?: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function UpdateModal() {
  const [status, setStatus] = useState<Status>('idle');
  const [info, setInfo] = useState<UpdateAvailableDetail | null>(null);
  const [progress, setProgress] = useState<DownloadState>({ downloaded: 0 });
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UpdateAvailableDetail>).detail;
      if (!detail) return;
      // Debounce: ignore new prompts while a download/install is in flight
      // or already showing the post-install state.
      if (status === 'downloading' || status === 'done') return;
      setInfo(detail);
      setProgress({ downloaded: 0 });
      setErrorMsg('');
      setStatus('prompt');
    };
    window.addEventListener(UPDATE_AVAILABLE_EVENT, handler);
    return () => window.removeEventListener(UPDATE_AVAILABLE_EVENT, handler);
  }, [status]);

  const startDownload = useCallback(async () => {
    if (!info) return;
    setStatus('downloading');
    setProgress({ downloaded: 0 });
    try {
      await performUpdate(info.id, (event) => {
        if (event.event === 'Started') {
          setProgress({ downloaded: 0, contentLength: event.contentLength });
        } else if (event.event === 'Progress') {
          setProgress({ downloaded: event.downloaded, contentLength: event.contentLength });
        } else if (event.event === 'Finished') {
          setProgress((p) => ({ ...p, downloaded: p.contentLength ?? p.downloaded }));
        }
      });
      setStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [info]);

  const dismiss = useCallback(() => {
    if (status === 'downloading') return; // can't cancel mid-download
    if (info) clearPendingUpdate(info.id);
    setStatus('idle');
    setInfo(null);
    setProgress({ downloaded: 0 });
    setErrorMsg('');
  }, [info, status]);

  const retry = useCallback(() => {
    setErrorMsg('');
    setStatus('prompt');
  }, []);

  const open = status !== 'idle';
  const pct =
    progress.contentLength && progress.contentLength > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.contentLength) * 100))
      : null;

  return (
    <AnimatePresence>
      {open && info && (
        <motion.div
          key="update-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={status === 'prompt' ? dismiss : undefined}
        >
          <motion.div
            key="update-modal-card"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-md bg-surface dark:bg-surface-dark rounded-2xl shadow-2xl border border-border/50 dark:border-border-dark/50 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 flex items-center justify-between border-b border-border/40 dark:border-border-dark/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-primary/10 dark:bg-primary/15 flex items-center justify-center">
                  {status === 'error' ? (
                    <AlertCircle size={16} className="text-primary" />
                  ) : status === 'done' ? (
                    <CheckCircle2 size={16} className="text-primary" />
                  ) : (
                    <Download size={16} className="text-primary" />
                  )}
                </div>
                <h3 className="font-semibold text-[15px] text-text dark:text-text-inv">
                  {status === 'done'
                    ? '更新已下载'
                    : status === 'error'
                    ? '更新失败'
                    : status === 'downloading'
                    ? '正在下载更新'
                    : '发现新版本'}
                </h3>
              </div>
              {(status === 'prompt' || status === 'error') && (
                <button
                  onClick={dismiss}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-text/5 dark:hover:bg-text-inv/5 transition-colors"
                  aria-label="Close"
                >
                  <X size={16} className="text-text/60 dark:text-text-inv/60" />
                </button>
              )}
            </div>

            <div className="px-5 py-4">
              {status === 'prompt' && (
                <>
                  <p className="text-[13px] text-text/70 dark:text-text-inv/65 mb-3">
                    新版本 <span className="font-semibold text-text dark:text-text-inv">{info.version}</span>
                    <span className="text-text/50 dark:text-text-inv/45"> （当前 {info.currentVersion}）</span>
                  </p>
                  {info.body && (
                    <div className="max-h-48 overflow-y-auto rounded-xl bg-text/[0.03] dark:bg-text-inv/[0.04] px-3 py-2.5 text-[12.5px] leading-relaxed text-text/75 dark:text-text-inv/70 whitespace-pre-wrap">
                      {info.body}
                    </div>
                  )}
                </>
              )}

              {status === 'downloading' && (
                <>
                  <div className="h-2 rounded-full bg-text/10 dark:bg-text-inv/10 overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: pct !== null ? `${pct}%` : '40%' }}
                    />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[12px] text-text/60 dark:text-text-inv/55 tabular-nums">
                    <span>
                      {formatBytes(progress.downloaded)}
                      {progress.contentLength ? ` / ${formatBytes(progress.contentLength)}` : ''}
                    </span>
                    <span>{pct !== null ? `${pct}%` : '准备中…'}</span>
                  </div>
                  <p className="mt-3 text-[12px] text-text/50 dark:text-text-inv/45">
                    下载中，无法中断。请保持应用打开。
                  </p>
                </>
              )}

              {status === 'done' && (
                <p className="text-[13px] text-text/75 dark:text-text-inv/70">
                  版本 <span className="font-semibold">{info.version}</span> 已下载并安装完成。请手动重启应用以完成更新。
                </p>
              )}

              {status === 'error' && (
                <>
                  <p className="text-[13px] text-text/75 dark:text-text-inv/70 mb-2">下载或安装更新时出错：</p>
                  <div className="rounded-xl bg-red-500/8 border border-red-500/20 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400 break-words">
                    {errorMsg || '未知错误'}
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-3.5 flex items-center justify-end gap-2 border-t border-border/40 dark:border-border-dark/40 bg-text/[0.015] dark:bg-text-inv/[0.02]">
              {status === 'prompt' && (
                <>
                  <button
                    onClick={dismiss}
                    className="px-3.5 py-2 rounded-xl text-[13px] font-medium text-text/65 dark:text-text-inv/60 hover:bg-text/5 dark:hover:bg-text-inv/5 transition-colors"
                  >
                    稍后
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={startDownload}
                    className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-primary text-white hover:bg-primary/90 transition-colors shadow-sm"
                  >
                    立即更新
                  </motion.button>
                </>
              )}
              {status === 'downloading' && (
                <button
                  disabled
                  className="px-4 py-2 rounded-xl text-[13px] font-medium bg-text/10 dark:bg-text-inv/10 text-text/50 dark:text-text-inv/45 cursor-not-allowed"
                >
                  下载中…
                </button>
              )}
              {status === 'done' && (
                <button
                  onClick={dismiss}
                  className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-primary text-white hover:bg-primary/90 transition-colors"
                >
                  好的
                </button>
              )}
              {status === 'error' && (
                <>
                  <button
                    onClick={dismiss}
                    className="px-3.5 py-2 rounded-xl text-[13px] font-medium text-text/65 dark:text-text-inv/60 hover:bg-text/5 dark:hover:bg-text-inv/5 transition-colors"
                  >
                    关闭
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={retry}
                    className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-primary text-white hover:bg-primary/90 transition-colors"
                  >
                    重试
                  </motion.button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
