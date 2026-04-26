import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, User, Sliders, Bell, Volume2, Download, Upload, Check } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { getUserName, setUserName } from '../App';
import { getSoundEnabled, setSoundEnabled } from '../hooks/useNotificationSound';
import { useNotificationPermission } from '../hooks/useNotificationPermission';

const STREAMING_OUTPUT_KEY = 'clawline.streaming.enabled';

export default function Preferences({ onBack }: { onBack: () => void }) {
  const [streamingEnabled, setStreamingEnabled] = useState(() => {
    const stored = localStorage.getItem(STREAMING_OUTPUT_KEY);
    if (stored === null) {
      localStorage.setItem(STREAMING_OUTPUT_KEY, 'true');
      return true;
    }
    return stored !== 'false';
  });

  const { permission, active, requestPermission: _rp, optOut, optIn } = useNotificationPermission();
  void _rp;

  const handleStreamingToggle = (checked: boolean) => {
    setStreamingEnabled(checked);
    localStorage.setItem(STREAMING_OUTPUT_KEY, checked ? 'true' : 'false');
  };

  // ── Config export / import ──────────────────────────────────────
  const CONFIG_VERSION = 1;
  const EXPORT_KEYS = [
    'clawline.connections',
    'clawline.userName',
    'clawline.darkMode',
    'clawline.streaming.enabled',
    'clawline.agentNames',
    'clawline.agentFavorites',
    'clawline.chatlist.viewMode',
    'clawline.chatlist.expandedIds',
    'clawline.sidebar.width',
    'clawline.inAppNotif',
    'clawline.pushNotif',
    'clawline:voiceMode',
    'volcASR.config',
    'clawline.agentAvatars',
  ];

  const [importStatus, setImportStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const data: Record<string, unknown> = { _version: CONFIG_VERSION };
    for (const key of EXPORT_KEYS) {
      const val = localStorage.getItem(key);
      if (val !== null) data[key] = val;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('clawline.agentOrder.') || k.startsWith('clawline.split')) {
        data[k] = localStorage.getItem(k);
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clawline-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!data || typeof data !== 'object') throw new Error('Invalid format');
        for (const [key, val] of Object.entries(data)) {
          if (key === '_version') continue;
          if (typeof val === 'string') localStorage.setItem(key, val);
        }
        setImportStatus('ok');
        setTimeout(() => {
          setImportStatus('idle');
          window.location.reload();
        }, 1200);
      } catch {
        setImportStatus('error');
        setTimeout(() => setImportStatus('idle'), 2500);
      }
      if (importInputRef.current) importInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-full bg-surface dark:bg-surface-dark">
      <div className="px-4 py-4 sticky top-0 bg-surface/80 dark:bg-surface-dark/80 backdrop-blur-xl z-20 flex items-center justify-between">
        <motion.button whileTap={{ scale: 0.9 }} onClick={onBack} aria-label="Go back" title="Go back" className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2 text-text dark:text-text-inv">
          <ChevronLeft size={28} />
        </motion.button>
        <h2 className="font-semibold text-[17px]">Preferences</h2>
        <div className="w-11" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 pb-32 space-y-8 max-w-xl mx-auto w-full">

        <section>
          <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 mb-4 uppercase tracking-wider flex items-center gap-2">
            <User size={16} /> Personal Info
          </h3>
          <Card className="p-5 space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1.5">Display Name</label>
              <Input defaultValue={getUserName()} onChange={(e) => setUserName(e.target.value)} />
            </div>
          </Card>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 mb-4 uppercase tracking-wider flex items-center gap-2">
            <Sliders size={16} /> Chat Settings
          </h3>
          <Card className="p-5">
            <motion.div layout className="flex items-center justify-between gap-4 rounded-[24px] border border-border dark:border-border-dark bg-surface/80 dark:bg-surface-dark/80 px-4 py-4">
              <div className="min-w-0">
                <label htmlFor="streaming-output-toggle" className="block text-[15px] font-semibold text-text dark:text-text-inv">Streaming Output</label>
                <p className="mt-1 text-[13px] text-text/50 dark:text-text-inv/50">Show AI responses character by character</p>
              </div>
              <input
                id="streaming-output-toggle"
                type="checkbox"
                className="ios-toggle shrink-0"
                checked={streamingEnabled}
                onChange={(e) => handleStreamingToggle(e.target.checked)}
                aria-label="Toggle streaming output"
              />
            </motion.div>
          </Card>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 mb-4 uppercase tracking-wider flex items-center gap-2">
            <Volume2 size={16} /> Notification Sound
          </h3>
          <Card className="p-5">
            <motion.div layout className="flex items-center justify-between gap-4 rounded-[24px] border border-border dark:border-border-dark bg-surface/80 dark:bg-surface-dark/80 px-4 py-4">
              <div className="min-w-0">
                <label htmlFor="sound-toggle" className="block text-[15px] font-semibold text-text dark:text-text-inv">Sound Effects</label>
                <p className="mt-1 text-[13px] text-text/50 dark:text-text-inv/50">Play a notification sound when agents reply</p>
              </div>
              <input
                id="sound-toggle"
                type="checkbox"
                className="ios-toggle shrink-0"
                checked={getSoundEnabled()}
                onChange={(e) => setSoundEnabled(e.target.checked)}
                aria-label="Toggle notification sound"
              />
            </motion.div>
          </Card>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 mb-4 uppercase tracking-wider flex items-center gap-2">
            <Bell size={16} /> Notifications
          </h3>
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-text dark:text-text-inv">Push Notifications</p>
                <p className="text-[12px] text-text/50 dark:text-text-inv/50 mt-0.5">
                  {permission === 'denied'
                    ? 'Blocked by browser — enable in browser settings'
                    : permission === 'unsupported'
                    ? 'Not supported in this browser'
                    : active
                    ? 'On — notified when a message arrives in background'
                    : 'Off — tap to enable'}
                </p>
              </div>
              {permission === 'denied' || permission === 'unsupported' ? (
                <div className="w-12 h-6 rounded-full bg-text/10 dark:bg-text-inv/10 flex-shrink-0" />
              ) : (
                <button
                  role="switch"
                  aria-checked={active}
                  onClick={() => { if (active) { optOut(); } else { void optIn(); } }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/20 ${active ? 'bg-primary' : 'bg-text/20 dark:bg-text-inv/20'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${active ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              )}
            </div>
          </Card>
        </section>

        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text/40 dark:text-text-inv/40 mb-3">数据备份</h2>
          <Card className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-text dark:text-text-inv">导出配置</p>
                <p className="text-[12px] text-text/50 dark:text-text-inv/40 mt-0.5">将服务器列表、名字、收藏、偏好等全部设置导出为 JSON 文件</p>
              </div>
              <motion.button whileTap={{ scale: 0.93 }} onClick={handleExport} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium bg-primary/10 text-primary dark:bg-primary/15 hover:bg-primary/20 transition-colors shrink-0">
                <Download size={14} />导出
              </motion.button>
            </div>
            <div className="h-px bg-border/40 dark:bg-border-dark/40" />
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-text dark:text-text-inv">导入配置</p>
                <p className="text-[12px] text-text/50 dark:text-text-inv/40 mt-0.5">从之前导出的 JSON 文件恢复所有设置，导入后页面将自动刷新</p>
              </div>
              <motion.button
                whileTap={{ scale: 0.93 }}
                onClick={() => importInputRef.current?.click()}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium shrink-0 transition-colors ${
                  importStatus === 'ok' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : importStatus === 'error' ? 'bg-red-500/10 text-red-500'
                  : 'bg-text/[0.06] dark:bg-text-inv/[0.06] text-text dark:text-text-inv hover:bg-text/[0.1] dark:hover:bg-text-inv/[0.1]'
                }`}
              >
                {importStatus === 'ok' ? (<><Check size={14} />已导入</>) : importStatus === 'error' ? (<>格式错误</>) : (<><Upload size={14} />导入</>)}
              </motion.button>
              <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
            </div>
          </Card>
        </section>

      </div>
    </div>
  );
}
