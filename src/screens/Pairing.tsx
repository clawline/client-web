import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Server, ArrowRight, Link2, QrCode, Settings2, Camera, ClipboardPaste } from 'lucide-react';
import { addConnection } from '../services/connectionStore';
import { getUserId } from '../App';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';

type TabId = 'url' | 'qr' | 'manual';

// Parse a connection URL like:
// ws://host:18080/ws?chatId=xxx&token=xxx&senderId=xxx&agentId=xxx
// or openclaw://connect?serverUrl=ws://...&token=xxx&chatId=xxx
function parseConnectionUrl(raw: string): { serverUrl: string; token?: string; chatId?: string; senderId?: string; displayName?: string; channelName?: string; channelId?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Handle openclaw:// custom scheme
  if (trimmed.startsWith('openclaw://')) {
    try {
      const url = new URL(trimmed.replace('openclaw://', 'https://'));
      const serverUrl = url.searchParams.get('serverUrl') || '';

      // Extract token/chatId from inner serverUrl if present
      let innerToken: string | undefined;
      let innerChatId: string | undefined;
      let innerChannelId: string | undefined;
      if (serverUrl) {
        try {
          const inner = new URL(serverUrl.replace(/^ws/, 'http'));
          innerToken = inner.searchParams.get('token') || undefined;
          innerChatId = inner.searchParams.get('chatId') || undefined;
          innerChannelId = inner.searchParams.get('channelId') || undefined;
        } catch { /* ignore */ }
      }

      return {
        serverUrl,
        token: url.searchParams.get('token') || innerToken,
        chatId: url.searchParams.get('chatId') || innerChatId,
        senderId: url.searchParams.get('senderId') || undefined,
        displayName: url.searchParams.get('displayName') || url.searchParams.get('name') || undefined,
        channelName: url.searchParams.get('channelName') || undefined,
        channelId: url.searchParams.get('channelId') || innerChannelId,
      };
    } catch { return null; }
  }

  // Handle ws:// or wss:// URL with query params
  if (/^wss?:\/\//.test(trimmed)) {
    try {
      const url = new URL(trimmed.replace(/^ws/, 'http'));
      const base = trimmed.split('?')[0];
      return {
        serverUrl: base,
        token: url.searchParams.get('token') || undefined,
        chatId: url.searchParams.get('chatId') || undefined,
        senderId: url.searchParams.get('senderId') || undefined,
        displayName: url.searchParams.get('name') || undefined,
        channelId: url.searchParams.get('channelId') || undefined,
      };
    } catch { return null; }
  }

  return null;
}

export default function Pairing({ onBack, onPaired }: { onBack: () => void; onPaired: (connId: string) => void }) {
  const [tab, setTab] = useState<TabId>('url');
  const [urlInput, setUrlInput] = useState('');
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [senderId, setSenderId] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- URL parsing preview ---
  const parsedUrl = urlInput.trim() ? parseConnectionUrl(urlInput) : null;
  const parsedFields = parsedUrl && parsedUrl.serverUrl ? (() => {
    try {
      const hostUrl = new URL(parsedUrl.serverUrl.replace(/^ws/, 'http'));
      return {
        host: hostUrl.hostname,
        port: hostUrl.port || (parsedUrl.serverUrl.startsWith('wss') ? '443' : '80'),
        path: hostUrl.pathname,
        secure: parsedUrl.serverUrl.startsWith('wss'),
        token: parsedUrl.token,
        chatId: parsedUrl.chatId,
        senderId: parsedUrl.senderId,
        displayName: parsedUrl.displayName,
        channelName: parsedUrl.channelName,
        channelId: parsedUrl.channelId,
      };
    } catch { return null; }
  })() : null;

  // --- URL quick login ---
  const handleUrlLogin = () => {
    if (!parsedUrl || !parsedUrl.serverUrl) {
      setError('Invalid connection URL. Expected ws:// or openclaw:// format.');
      return;
    }
    // Build a human-friendly connection name: "channelName" or "channelName/user" or hostname
    const channelLabel = parsedUrl.channelName || parsedUrl.channelId;
    const userLabel = parsedUrl.senderId;
    const connName = channelLabel
      ? (userLabel ? `${channelLabel} (${userLabel})` : channelLabel)
      : parsedUrl.displayName || new URL(parsedUrl.serverUrl.replace(/^ws/, 'http')).hostname;
    const conn = addConnection(
      connName,
      parsedUrl.serverUrl,
      parsedUrl.displayName || parsedUrl.senderId || 'OpenClaw User',
      parsedUrl.token,
      parsedUrl.chatId,
      parsedUrl.senderId,
    );
    onPaired(conn.id);
  };

  // --- QR code scan ---
  const startScan = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setScanning(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      // Use BarcodeDetector if available
      const detector = 'BarcodeDetector' in window ? new (window as any).BarcodeDetector({ formats: ['qr_code'] }) : null;

      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || !canvasRef.current || !detector) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0);
        try {
          const barcodes = await detector.detect(canvas);
          if (barcodes.length > 0) {
            const value = barcodes[0].rawValue;
            stopScan();
            const parsed = parseConnectionUrl(value);
            if (parsed && parsed.serverUrl) {
              const connName = parsed.displayName || new URL(parsed.serverUrl.replace(/^ws/, 'http')).hostname;
              const conn = addConnection(connName, parsed.serverUrl, parsed.displayName || 'OpenClaw User', parsed.token, parsed.chatId, parsed.senderId);
              onPaired(conn.id);
            } else {
              setUrlInput(value);
              setTab('url');
              setError('QR code scanned — please verify and connect.');
            }
          }
        } catch { /* ignore detection errors */ }
      }, 500);
    } catch {
      setError('Camera access denied. Try pasting a URL instead.');
    }
  };

  const stopScan = () => {
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setScanning(false);
  };

  // --- Manual form ---
  const handlePair = () => {
    const trimmedName = name.trim();
    const trimmedUrl = serverUrl.trim();
    const trimmedDisplayName = displayName.trim();

    if (!trimmedName) { setError('Connection name is required.'); return; }
    if (!trimmedDisplayName) { setError('Display name is required.'); return; }
    if (!trimmedUrl) { setError('WebSocket URL is required.'); return; }
    if (!/^wss?:\/\/.+/.test(trimmedUrl)) { setError('URL must start with ws:// or wss://'); return; }

    const conn = addConnection(trimmedName, trimmedUrl, trimmedDisplayName, token.trim() || undefined, chatId.trim() || undefined, senderId.trim() || undefined);
    onPaired(conn.id);
  };

  const tabs = [
    { id: 'url' as TabId, icon: Link2, label: 'URL' },
    { id: 'qr' as TabId, icon: QrCode, label: 'Scan' },
    { id: 'manual' as TabId, icon: Settings2, label: 'Manual' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#F8FAFB] dark:bg-[#1a1b2e]">
      {/* Header */}
      <div className="px-4 py-4 sticky top-0 bg-[#F8FAFB]/80 dark:bg-[#1a1b2e]/80 backdrop-blur-xl z-20 flex items-center justify-between">
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { stopScan(); onBack(); }} className="p-2 -ml-2 text-[#2D3436] dark:text-[#e2e8f0]">
          <ChevronLeft size={28} />
        </motion.button>
        <h2 className="font-semibold text-[17px]">Connect Server</h2>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 pb-32 space-y-6 max-w-xl mx-auto w-full">
        {/* Hero */}
        <div className="flex flex-col items-center text-center pt-2 pb-1">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-14 h-14 bg-gradient-to-br from-[#67B88B] to-[#4a9a70] rounded-[18px] flex items-center justify-center shadow-lg shadow-[#67B88B]/30 mb-4"
          >
            <Server size={24} className="text-white" />
          </motion.div>
          <h1 className="text-xl font-bold mb-1">Connect Workspace</h1>
          <p className="text-[#2D3436]/50 dark:text-[#e2e8f0]/50 text-[14px]">Paste a URL, scan QR code, or configure manually</p>
        </div>

        {/* Tab selector */}
        <div className="flex bg-white dark:bg-[#232437] rounded-full p-1 border border-[#EDF2F0] dark:border-[#2d3748] shadow-sm">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); if (t.id !== 'qr') stopScan(); setError(''); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-[13px] font-medium transition-all ${
                  active ? 'bg-[#67B88B] text-white shadow-md' : 'text-[#2D3436]/50 dark:text-[#e2e8f0]/50'
                }`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-red-500 text-[13px] text-center">
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* URL Tab */}
        {tab === 'url' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <Card className="p-5 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1.5">Connection URL</label>
                <div className="relative">
                  <Input
                    value={urlInput}
                    onChange={(e) => { setUrlInput(e.target.value); setError(''); }}
                    placeholder="ws://host:18080/ws?chatId=xxx&token=xxx"
                    className="pr-12"
                  />
                  <motion.button
                    whileTap={{ scale: 0.85 }}
                    type="button"
                    onClick={async () => {
                      try {
                        const clip = await navigator.clipboard.readText();
                        if (clip) { setUrlInput(clip); setError(''); }
                      } catch { /* clipboard denied */ }
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[#2D3436]/30 dark:text-[#e2e8f0]/30 hover:text-[#67B88B] transition-colors rounded-full"
                  >
                    <ClipboardPaste size={18} />
                  </motion.button>
                </div>
              </div>
              {/* Parsed URL preview */}
              {parsedFields && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2 pt-2 border-t border-[#EDF2F0] dark:border-[#2d3748]">
                  <p className="text-[11px] font-semibold text-[#67B88B] tracking-wide uppercase">Parsed Connection</p>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                    {(parsedFields.channelName || parsedFields.displayName) && <>
                      <span className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40">Server</span>
                      <span className="font-semibold text-[#67B88B]">{parsedFields.channelName || parsedFields.displayName}</span>
                    </>}
                    <span className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40">Host</span>
                    <span className="font-mono text-[#2D3436]/80 dark:text-[#e2e8f0]/80">{parsedFields.host}{parsedFields.path !== '/' ? parsedFields.path : ''}</span>
                    <span className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40">Protocol</span>
                    <span className="font-mono text-[#2D3436]/80 dark:text-[#e2e8f0]/80">{parsedFields.secure ? '🔒 WSS (secure)' : '⚠️ WS (plain)'}</span>
                    {parsedFields.channelId && <>
                      <span className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40">Channel</span>
                      <span className="font-mono text-[#2D3436]/80 dark:text-[#e2e8f0]/80">{parsedFields.channelId}</span>
                    </>}
                    {parsedFields.senderId && <>
                      <span className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40">User</span>
                      <span className="font-mono text-[#2D3436]/80 dark:text-[#e2e8f0]/80">{parsedFields.senderId}</span>
                    </>}
                    {parsedFields.token && <>
                      <span className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40">Token</span>
                      <span className="font-mono text-[#2D3436]/80 dark:text-[#e2e8f0]/80">{parsedFields.token.slice(0, 8)}{'…'}</span>
                    </>}
                  </div>
                </motion.div>
              )}
              {!parsedFields && (
                <p className="text-[11px] text-[#2D3436]/40 dark:text-[#e2e8f0]/40 leading-relaxed">
                  Supports: <code className="bg-[#EDF2F0] dark:bg-[#2d3748] px-1 rounded text-[10px]">ws://</code> / <code className="bg-[#EDF2F0] dark:bg-[#2d3748] px-1 rounded text-[10px]">wss://</code> with query params, or <code className="bg-[#EDF2F0] dark:bg-[#2d3748] px-1 rounded text-[10px]">openclaw://connect?serverUrl=...&token=...</code>
                </p>
              )}
            </Card>
            <Button size="lg" className="w-full" onClick={handleUrlLogin}>
              Connect <ArrowRight size={20} />
            </Button>
          </motion.div>
        )}

        {/* QR Tab */}
        {tab === 'qr' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <Card className="p-5 flex flex-col items-center">
              {scanning ? (
                <div className="relative w-full aspect-square rounded-[16px] overflow-hidden bg-black">
                  <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                  <div className="absolute inset-0 border-2 border-[#67B88B] rounded-[16px] pointer-events-none">
                    <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-[#67B88B]/60 animate-pulse" />
                  </div>
                  <canvas ref={canvasRef} className="hidden" />
                </div>
              ) : (
                <div className="flex flex-col items-center py-8">
                  <QrCode size={48} className="text-[#2D3436]/15 dark:text-[#e2e8f0]/15 mb-4" />
                  <p className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40 text-[14px] mb-4">Scan a server QR code to connect</p>
                  <Button onClick={startScan}>
                    <Camera size={18} /> Start Camera
                  </Button>
                </div>
              )}
            </Card>
            {scanning && (
              <Button variant="outline" className="w-full" onClick={stopScan}>Stop Scanning</Button>
            )}
            <p className="text-[11px] text-[#2D3436]/30 dark:text-[#e2e8f0]/30 text-center">
              {'BarcodeDetector' in window ? 'QR detection supported' : '⚠️ BarcodeDetector not available in this browser. Try Chrome or Edge.'}
            </p>
          </motion.div>
        )}

        {/* Manual Tab */}
        {tab === 'manual' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <Card className="p-5 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1.5">Connection Name</label>
                <Input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="e.g. My Dev Server" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1.5">Display Name</label>
                <Input value={displayName} onChange={(e) => { setDisplayName(e.target.value); setError(''); }} placeholder="e.g. Alex Developer" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1.5">Generic Channel WS URL</label>
                <Input value={serverUrl} onChange={(e) => { setServerUrl(e.target.value); setError(''); }} placeholder="ws://host:18080/ws" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1.5">Auth Token <span className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30 font-normal">(optional)</span></label>
                <Input value={token} onChange={(e) => { setToken(e.target.value); setError(''); }} placeholder="gc_user_xxxxxxxxx" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1.5">Chat ID <span className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30 font-normal">(token auth)</span></label>
                <Input value={chatId} onChange={(e) => { setChatId(e.target.value); setError(''); }} placeholder="gc-test-main" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1.5">Sender ID <span className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30 font-normal">(token auth)</span></label>
                <Input value={senderId} onChange={(e) => { setSenderId(e.target.value); setError(''); }} placeholder="gc-test-main" />
              </div>
            </Card>
            <Button size="lg" className="w-full" onClick={handlePair}>
              Pair and Continue <ArrowRight size={20} />
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
