import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, Moon, ChevronRight, LogOut, Bell, Smartphone, User, Server, Plus, Trash2, Check, Pencil, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import type { IdTokenClaims } from '@logto/react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { getConnections, removeConnection, updateConnection, getActiveConnectionId, setActiveConnectionId, type ServerConnection } from '../services/connectionStore';
import * as channel from '../services/clawChannel';

export default function Profile({ onNavigate }: { onNavigate: (screen: string) => void }) {
  const { signOut, getIdTokenClaims } = useAuth();
  const [userClaims, setUserClaims] = useState<IdTokenClaims | null>(null);
  const [connections, setConnections] = useState<ServerConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServerConnection | null>(null);
  const [editForm, setEditForm] = useState({ name: '', displayName: '', serverUrl: '', token: '', chatId: '', senderId: '' });
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const [pushNotif, setPushNotif] = useState(() => localStorage.getItem('openclaw.pushNotif') !== '0');
  const [inAppNotif, setInAppNotif] = useState(() => localStorage.getItem('openclaw.inAppNotif') !== '0');

  const refresh = useCallback(() => {
    setConnections(getConnections());
    setActiveId(getActiveConnectionId());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    void getIdTokenClaims().then((claims) => {
      if (claims) setUserClaims(claims);
    });
  }, [getIdTokenClaims]);

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (id === activeId) {
      channel.close();
      localStorage.removeItem('openclaw.agentList');
      localStorage.removeItem('openclaw.channelStatus');
    }
    removeConnection(id);
    refresh();
  };

  const handleActivate = (id: string) => {
    if (id === activeId) return;
    // Disconnect previous connection and clear caches
    channel.close();
    localStorage.removeItem('openclaw.agentList');
    localStorage.removeItem('openclaw.channelStatus');
    setActiveConnectionId(id);
    setActiveId(id);
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

  return (
    <div className="flex flex-col h-full pb-32 px-6 pt-12 overflow-y-auto max-w-2xl mx-auto w-full">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Profile</h1>

      <div className="flex items-center gap-5 mb-8">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#67B88B] to-[#4a9a70] flex items-center justify-center text-white shadow-md border-2 border-white overflow-hidden">
          {userClaims?.picture ? (
            <img src={userClaims.picture} alt="avatar" className="w-full h-full object-cover" />
          ) : (
            <User size={36} />
          )}
        </div>
        <div>
          <h2 className="text-xl font-bold">{userClaims?.name || userClaims?.username || 'OpenClaw User'}</h2>
          <p className="text-[#2D3436]/50 dark:text-[#e2e8f0]/50 text-sm">{userClaims?.email || 'Signed in via Logto'}</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Server Management */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#2D3436]/50 dark:text-[#e2e8f0]/50 uppercase tracking-wider flex items-center gap-2">
              <Server size={14} /> Servers
            </h3>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onNavigate('pairing')}>
              <Plus size={18} className="text-[#67B88B]" />
            </Button>
          </div>

          {connections.length > 0 ? (
              <Card className="overflow-hidden divide-y divide-[#EDF2F0] dark:divide-[#2d3748]">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  onClick={() => handleActivate(conn.id)}
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[#F8FAFB]/50 dark:hover:bg-[#1a1b2e]/50 transition-colors"
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    activeId === conn.id 
                      ? 'bg-[#67B88B] text-white' 
                      : 'bg-[#F8FAFB] dark:bg-[#1a1b2e] text-[#2D3436]/40 dark:text-[#e2e8f0]/40'
                  }`}>
                    {activeId === conn.id ? <Check size={18} /> : <Server size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[15px] truncate">{conn.name}</p>
                    <p className="text-[12px] text-[#2D3436]/40 dark:text-[#e2e8f0]/40 truncate">{conn.serverUrl}</p>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.8 }}
                    onClick={(e) => openEdit(e, conn)}
                    className="p-2 text-[#2D3436]/20 dark:text-[#e2e8f0]/20 hover:text-[#5B8DEF] transition-colors flex-shrink-0"
                  >
                    <Pencil size={14} />
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.8 }}
                    onClick={(e) => handleRemove(e, conn.id)}
                    className="p-2 text-[#2D3436]/20 dark:text-[#e2e8f0]/20 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <Trash2 size={14} />
                  </motion.button>
                </div>
              ))}
            </Card>
          ) : (
            <Card className="p-6 flex flex-col items-center text-center">
              <Server size={24} className="text-[#2D3436]/20 dark:text-[#e2e8f0]/20 mb-2" />
              <p className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40 text-[14px] mb-3">No servers connected</p>
              <Button size="sm" onClick={() => onNavigate('pairing')}>
                <Plus size={16} /> Add Server
              </Button>
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
          <div className="h-[1px] bg-[#EDF2F0] dark:bg-[#2d3748] ml-14" />
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
          <div className="h-[1px] bg-[#EDF2F0] dark:bg-[#2d3748] ml-14" />
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
              className="w-full max-w-md bg-white dark:bg-[#232437] rounded-t-[32px] p-6 pb-8 space-y-4 shadow-2xl mb-[90px] max-h-[75vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold">Edit Server</h3>
                <motion.button whileTap={{ scale: 0.8 }} onClick={() => setEditing(null)} className="p-1 text-[#2D3436]/30 dark:text-[#e2e8f0]/30">
                  <X size={20} />
                </motion.button>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1">Connection Name</label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1">Display Name</label>
                <Input value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1">WS URL</label>
                <Input value={editForm.serverUrl} onChange={(e) => setEditForm({ ...editForm, serverUrl: e.target.value })} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1">Auth Token <span className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30 font-normal">(optional)</span></label>
                <Input value={editForm.token} onChange={(e) => setEditForm({ ...editForm, token: e.target.value })} placeholder="gc_user_xxxxxxxxx" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1">Chat ID <span className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30 font-normal">(token auth)</span></label>
                <Input value={editForm.chatId} onChange={(e) => setEditForm({ ...editForm, chatId: e.target.value })} placeholder="gc-test-main" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#2D3436]/70 dark:text-[#e2e8f0]/70 mb-1">Sender ID <span className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30 font-normal">(token auth)</span></label>
                <Input value={editForm.senderId} onChange={(e) => setEditForm({ ...editForm, senderId: e.target.value })} placeholder="gc-test-main" />
              </div>
              <Button className="w-full" onClick={saveEdit}>Save Changes</Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SettingItem({ icon: Icon, label, value, hasToggle, active, onClick }: any) {
  return (
    <motion.div 
      whileTap={{ backgroundColor: 'rgba(0,0,0,0.02)' }}
      onClick={onClick}
      className="flex items-center justify-between p-4 cursor-pointer"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-[#F8FAFB] dark:bg-[#1a1b2e] flex items-center justify-center text-[#2D3436] dark:text-[#e2e8f0]">
          <Icon size={20} />
        </div>
        <span className="font-medium text-[16px]">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        {value && <span className="text-sm text-[#2D3436]/40 dark:text-[#e2e8f0]/40">{value}</span>}
        {hasToggle ? (
          <div className={`w-12 h-7 rounded-full p-1 transition-colors ${active ? 'bg-[#67B88B]' : 'bg-[#EDF2F0] dark:bg-[#2d3748]'}`}>
            <div className={`w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform ${active ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
        ) : (
          <ChevronRight size={20} className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30" />
        )}
      </div>
    </motion.div>
  );
}
