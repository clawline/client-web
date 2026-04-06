import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, Moon, ChevronRight, LogOut, Bell, Smartphone, User, Server, Trash2, Check, Pencil, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useLogto, type IdTokenClaims } from '@logto/react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { CONNECTIONS_UPDATED_EVENT, getConnections, moveConnection, removeConnection, updateConnection, getActiveConnectionId, setActiveConnectionId, type ServerConnection } from '../services/connectionStore';
import * as channel from '../services/clawChannel';

export default function Profile({ onNavigate }: { onNavigate: (screen: string) => void }) {
  const { signOut, getIdTokenClaims } = useLogto();
  const [userClaims, setUserClaims] = useState<IdTokenClaims | null>(null);
  const [connections, setConnections] = useState<ServerConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServerConnection | null>(null);
  const [editForm, setEditForm] = useState({ name: '', displayName: '', serverUrl: '', token: '', chatId: '', senderId: '' });
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const [pushNotif, setPushNotif] = useState(() => localStorage.getItem('openclaw.pushNotif') !== '0');
  const [inAppNotif, setInAppNotif] = useState(() => localStorage.getItem('openclaw.inAppNotif') !== '0');

  const refresh = useCallback(() => {
    setConnections(getConnections());
    setActiveId(getActiveConnectionId());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const handleConnectionsUpdated = () => refresh();
    window.addEventListener(CONNECTIONS_UPDATED_EVENT, handleConnectionsUpdated);
    return () => window.removeEventListener(CONNECTIONS_UPDATED_EVENT, handleConnectionsUpdated);
  }, [refresh]);

  useEffect(() => {
    void getIdTokenClaims().then((claims) => {
      if (claims) setUserClaims(claims);
    });
  }, [getIdTokenClaims]);

  // Reactive connection status — subscribe to each connection's status changes
  useEffect(() => {
    const initial: Record<string, string> = {};
    const unsubs: (() => void)[] = [];
    for (const conn of connections) {
      initial[conn.id] = channel.getStatus(conn.id);
      const connId = conn.id;
      unsubs.push(channel.onStatus((status) => {
        setStatusMap((prev) => ({ ...prev, [connId]: status }));
      }, connId));
    }
    setStatusMap(initial);
    return () => unsubs.forEach((u) => u());
  }, [connections]);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const confirmRemove = () => {
    if (!pendingDeleteId) return;
    if (pendingDeleteId === activeId) {
      channel.close(true, pendingDeleteId);
    }
    removeConnection(pendingDeleteId);
    setPendingDeleteId(null);
    refresh();
  };

  const handleActivate = (id: string) => {
    if (id === activeId) return;
    setActiveConnectionId(id);
    setActiveId(id);
  };

  const handleMove = (e: React.MouseEvent, id: string, direction: -1 | 1) => {
    e.stopPropagation();
    moveConnection(id, direction);
    refresh();
  };

  const openEdit = (e: React.MouseEvent, conn: ServerConnection) => {
    e.stopPropagation();
    setEditing(conn);
    setEditForm({ name: conn.name, displayName: conn.displayName, serverUrl: conn.serverUrl, token: conn.token || '', chatId: conn.chatId || '', senderId: conn.senderId || '' });
  };

  const saveEdit = () => {
    if (!editing) return;
    updateConnection(editing.id, {
      name: editForm.name.trim() || editing.name,
      displayName: editForm.displayName.trim() || editing.displayName,
      serverUrl: editForm.serverUrl.trim() || editing.serverUrl,
      token: editForm.token.trim() || undefined,
      chatId: editForm.chatId.trim() || undefined,
      senderId: editForm.senderId.trim() || undefined,
    });
    setEditing(null);
    refresh();
  };

  const isTokenMode = editForm.token.trim().length > 0;

  return (
    <div className="flex flex-col h-full pb-32 px-6 pt-12 overflow-y-auto max-w-2xl mx-auto w-full">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Profile</h1>

      <div className="flex items-center gap-5 mb-8">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-[#6D28D9] flex items-center justify-center text-white shadow-md border-2 border-white overflow-hidden">
          {userClaims?.picture ? (
            <img src={userClaims.picture} alt="avatar" className="w-full h-full object-cover" />
          ) : (
            <User size={32} />
          )}
        </div>
        <div>
          <h2 className="text-xl font-bold">{userClaims?.name || userClaims?.username || 'OpenClaw User'}</h2>
        </div>
      </div>

      <div className="space-y-6">
        {/* Server Management */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 uppercase tracking-wider flex items-center gap-2">
              <Server size={14} /> Servers
            </h3>
          </div>

          {connections.length > 0 ? (
              <Card className="overflow-hidden divide-y divide-border dark:divide-border-dark">
              {connections.map((conn, index) => (
                <div
                  key={conn.id}
                  onClick={() => handleActivate(conn.id)}
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-surface/50 dark:hover:bg-surface-dark/50 transition-colors"
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    activeId === conn.id 
                      ? 'bg-primary text-white' 
                      : 'bg-surface dark:bg-surface-dark text-text/40 dark:text-text-inv/40'
                  }`}>
                    {activeId === conn.id ? <Check size={18} /> : <Server size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[15px] truncate">{conn.displayName || conn.name}</p>
                    <p className="text-[11px] mt-0.5 flex items-center gap-1.5">
                      {(() => {
                        const status = statusMap[conn.id] || 'disconnected';
                        if (status === 'connected') return <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /><span className="text-emerald-600 dark:text-emerald-400">Connected</span></>;
                        if (status === 'connecting' || status === 'reconnecting') return <><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" /><span className="text-amber-600 dark:text-amber-400">{status === 'connecting' ? 'Connecting' : 'Reconnecting'}</span></>;
                        return <><span className="w-1.5 h-1.5 rounded-full bg-text/20 dark:bg-text-inv/20 inline-block" /><span className="text-text/35 dark:text-text-inv/30">Disconnected</span></>;
                      })()}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <motion.button
                      whileTap={{ scale: 0.8 }}
                      onClick={(e) => handleMove(e, conn.id, -1)}
                      className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-text/20 dark:text-text-inv/20 hover:text-text/60 dark:hover:text-text-inv/60 transition-colors"
                      disabled={index === 0}
                    >
                      <ChevronUp size={16} />
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.8 }}
                      onClick={(e) => handleMove(e, conn.id, 1)}
                      className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-text/20 dark:text-text-inv/20 hover:text-text/60 dark:hover:text-text-inv/60 transition-colors"
                      disabled={index === connections.length - 1}
                    >
                      <ChevronDown size={16} />
                    </motion.button>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.8 }}
                    onClick={(e) => openEdit(e, conn)}
                    className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-text/20 dark:text-text-inv/20 hover:text-info transition-colors flex-shrink-0"
                  >
                    <Pencil size={16} />
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.8 }}
                    onClick={(e) => handleRemove(e, conn.id)}
                    className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-text/20 dark:text-text-inv/20 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <Trash2 size={16} />
                  </motion.button>
                </div>
              ))}
            </Card>
          ) : (
            <Card className="p-6 flex flex-col items-center text-center">
              <Server size={24} className="text-text/20 dark:text-text-inv/20 mb-2" />
              <p className="text-text/40 dark:text-text-inv/40 text-[14px]">No servers connected</p>
            </Card>
          )}
        </section>

        {/* Settings */}
        <Card className="overflow-hidden">
          <SettingItem icon={Moon} label="Dark Mode" hasToggle active={darkMode} onClick={() => {
            const next = !darkMode;
            setDarkMode(next);
            document.documentElement.classList.toggle('dark', next);
            localStorage.setItem('openclaw.darkMode', next ? '1' : '0');
          }} />
          <div className="h-[1px] bg-border dark:bg-border-dark ml-14" />
          <SettingItem icon={Bell} label="Push Notifications" hasToggle active={pushNotif} onClick={async () => {
            if (!pushNotif) {
              // Request permission
              if ('Notification' in window) {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') return;
              }
            }
            const next = !pushNotif;
            setPushNotif(next);
            localStorage.setItem('openclaw.pushNotif', next ? '1' : '0');
          }} />
          <div className="h-[1px] bg-border dark:bg-border-dark ml-14" />
          <SettingItem icon={Smartphone} label="In-App Notifications" hasToggle active={inAppNotif} onClick={() => {
            const next = !inAppNotif;
            setInAppNotif(next);
            localStorage.setItem('openclaw.inAppNotif', next ? '1' : '0');
          }} />
        </Card>

        <Card className="overflow-hidden">
          <SettingItem icon={Settings} label="Preferences" onClick={() => onNavigate('preferences')} />
        </Card>

        <Button variant="destructive" className="w-full" onClick={() => { signOut(window.location.origin); }}>
          <LogOut size={20} />
          Log Out
        </Button>

        <p className="text-center text-[11px] text-text/30 dark:text-text-inv/25 mt-4">
          Clawline v{__APP_VERSION__} ({__BUILD_HASH__})
        </p>
      </div>

      {/* Edit Server Modal */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 backdrop-blur-sm"
            onClick={() => setEditing(null)}
          >
            <motion.div
              initial={{ y: 300 }}
              animate={{ y: 0 }}
              exit={{ y: 300 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white dark:bg-card-alt rounded-t-[32px] p-6 pb-8 space-y-4 shadow-2xl mb-[90px] max-h-[75vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold">Edit Server</h3>
                <motion.button whileTap={{ scale: 0.8 }} onClick={() => setEditing(null)} className="p-1 text-text/50 dark:text-text-inv/50">
                  <X size={20} />
                </motion.button>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1">Connection Name</label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1">Display Name</label>
                <Input value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1">WS URL</label>
                <Input value={editForm.serverUrl} onChange={(e) => setEditForm({ ...editForm, serverUrl: e.target.value })} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1">Auth Token <span className="text-text/50 dark:text-text-inv/50 font-normal">(optional)</span></label>
                <Input value={editForm.token} onChange={(e) => setEditForm({ ...editForm, token: e.target.value })} placeholder="gc_user_xxxxxxxxx" />
              </div>
              {!isTokenMode && (
                <>
                  <div>
                    <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1">Chat ID <span className="text-text/50 dark:text-text-inv/50 font-normal">(token auth)</span></label>
                    <Input value={editForm.chatId} onChange={(e) => setEditForm({ ...editForm, chatId: e.target.value })} placeholder="gc-test-main" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1">Sender ID <span className="text-text/50 dark:text-text-inv/50 font-normal">(token auth)</span></label>
                    <Input value={editForm.senderId} onChange={(e) => setEditForm({ ...editForm, senderId: e.target.value })} placeholder="gc-test-main" />
                  </div>
                </>
              )}
              <Button className="w-full" onClick={saveEdit}>Save Changes</Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {pendingDeleteId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm px-6"
            onClick={() => setPendingDeleteId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-dialog-title"
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-card-alt p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="delete-dialog-title" className="text-[17px] font-semibold text-text dark:text-text-inv mb-2">Remove Server</h3>
              <p className="text-[14px] text-text/60 dark:text-text-inv/50 mb-5">
                This will disconnect and remove <span className="font-medium text-text dark:text-text-inv">{connections.find(c => c.id === pendingDeleteId)?.displayName || 'this server'}</span>. Chat history will be preserved locally.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setPendingDeleteId(null)}>Cancel</Button>
                <Button className="flex-1 bg-red-500 hover:bg-red-600 text-white" onClick={confirmRemove}>Remove</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface SettingItemProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value?: string;
  hasToggle?: boolean;
  active?: boolean;
  onClick?: () => void;
}

function SettingItem({ icon: Icon, label, value, hasToggle, active, onClick }: SettingItemProps) {
  return (
    <motion.div 
      whileTap={{ backgroundColor: 'rgba(0,0,0,0.02)' }}
      onClick={onClick}
      className="flex items-center justify-between p-4 cursor-pointer"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-surface dark:bg-surface-dark flex items-center justify-center text-text dark:text-text-inv">
          <Icon size={20} />
        </div>
        <span className="font-medium text-[16px]">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        {value && <span className="text-sm text-text/40 dark:text-text-inv/40">{value}</span>}
        {hasToggle ? (
          <div className={`w-12 h-7 rounded-full p-1 transition-colors ${active ? 'bg-primary' : 'bg-border dark:bg-border-dark'}`}>
            <div className={`w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform ${active ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
        ) : (
          <ChevronRight size={20} className="text-text/50 dark:text-text-inv/50" />
        )}
      </div>
    </motion.div>
  );
}
