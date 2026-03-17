import { useState, useEffect, useCallback } from "react";
import { LoginScreen } from "@/components/LoginScreen";
import { Nav, type ActivityItem } from "@/components/Nav";
import { ChannelForm } from "@/components/ChannelForm";
import { TabOverview } from "@/components/TabOverview";
import { TabUsers } from "@/components/TabUsers";
import { TabSettings } from "@/components/TabSettings";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, X, RefreshCw, Plus, Server } from "lucide-react";
import { api, animalIcon, SK, type ServerState, type ChannelInfo } from "@/lib/utils";

type Tab = "overview" | "users" | "settings";

export default function App() {
  const qt = new URLSearchParams(location.search).get("adminToken")?.trim() || "";
  const it = qt || localStorage.getItem(SK) || "";

  const [token, setToken] = useState(it);
  const [state, setState] = useState<ServerState | null>(null);
  const [authed, setAuthed] = useState(false);
  const [selId, setSelId] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [showNew, setShowNew] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; msg: string; isError: boolean }[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const toast = useCallback((msg: string, isError = false) => {
    const id = `${Date.now()}-${Math.random()}`;
    const ts = Date.now();
    setToasts(t => [...t, { id, msg, isError }]);
    setActivity(a => [{ id, msg, isError, ts }, ...a].slice(0, 20));
    setTimeout(() => setToasts(t => t.filter(i => i.id !== id)), 2400);
  }, []);

  const channels: ChannelInfo[] = Array.isArray(state?.channels) ? state.channels : [];
  const channel = channels.find(c => c.channelId === selId) || null;

  const loadState = useCallback(async (t?: string) => {
    try {
      const d = await api<ServerState>("/api/state", t ?? token);
      setState(d);
      setAuthed(true);
      setSelId(p => (p && d.channels?.some(c => c.channelId === p)) ? p : d.channels?.[0]?.channelId || "");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("admin auth required")) setAuthed(false);
      else toast(msg, true);
    }
  }, [token, toast]);

  useEffect(() => {
    if (qt) localStorage.setItem(SK, qt);
    if (it) { loadState(it); return; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = async (t: string) => {
    localStorage.setItem(SK, t);
    setToken(t);
    await loadState(t);
  };

  if (!authed) return <LoginScreen onLogin={handleLogin} />;

  const newChannel = async (d: { channelId: string; label: string; secret: string; tokenParam: string }) => {
    try {
      await api("/api/channels", token, { method: "POST", body: JSON.stringify(d) });
      toast(`已创建 ${d.channelId}`);
      setShowNew(false);
      await loadState();
      setSelId(d.channelId);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "创建失败", true);
    }
  };

  const deleteChannel = async () => {
    if (!channel || !confirm(`删除 ${channel.channelId}？`)) return;
    try {
      await api(`/api/channels/${encodeURIComponent(channel.channelId)}`, token, { method: "DELETE" });
      toast(`已删除 ${channel.channelId}`);
      await loadState();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "删除失败", true);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "概览" },
    { key: "users", label: "用户" },
    { key: "settings", label: "设置" },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block">
        <Nav channels={channels} selected={selId} onSelect={id => { setSelId(id); setTab("overview"); }} onNew={() => setShowNew(true)} activity={activity} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-2 border-b bg-background px-4 lg:hidden">
          <span className="flex items-center gap-2 font-semibold text-sm"><Server className="size-4" /> Relay</span>
          <div className="flex-1" />
          <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={selId} onChange={e => { setSelId(e.target.value); setTab("overview"); }}>
            {channels.map(c => <option key={c.channelId} value={c.channelId}>{c.label || c.channelId}</option>)}
          </select>
          <Button variant="outline" size="icon" onClick={() => setShowNew(true)}><Plus className="size-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => loadState()}><RefreshCw className="size-4" /></Button>
        </div>

        {channel ? (
          <>
            <div className="flex h-14 items-center justify-between border-b bg-background px-6">
              <div className="flex items-center gap-3">
                <span className="text-xl">{animalIcon(channel.channelId)}</span>
                <div>
                  <h2 className="text-sm font-semibold">{channel.label || channel.channelId}</h2>
                  <span className="font-mono text-xs text-muted-foreground">{channel.channelId}</span>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => loadState()}><RefreshCw className="size-4" /> 刷新</Button>
            </div>
            <div className="border-b bg-background">
              <div className="flex gap-1 px-6">
                {tabs.map(t => (
                  <button key={t.key} type="button" onClick={() => setTab(t.key)}
                    className={`border-b-2 px-3 py-3 text-sm font-medium transition-colors ${tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {tab === "overview" && <TabOverview state={state} channel={channel} toast={toast} />}
              {tab === "users" && <TabUsers state={state} channel={channel} token={token} onReload={loadState} toast={toast} />}
              {tab === "settings" && <TabSettings state={state} channel={channel} token={token} onReload={loadState} onDelete={deleteChannel} toast={toast} />}
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center">
            <div className="text-center">
              <p className="text-muted-foreground">{channels.length === 0 ? "暂无服务器" : "选择一个服务器"}</p>
              {channels.length === 0 && <Button variant="outline" className="mt-4" onClick={() => setShowNew(true)}><Plus className="size-4" /> 新建服务器</Button>}
            </div>
          </div>
        )}
      </div>

      <Dialog open={showNew} onOpenChange={v => { if (!v) setShowNew(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建服务器</DialogTitle>
            <DialogDescription>创建一个新的 relay channel</DialogDescription>
          </DialogHeader>
          <ChannelForm channel={null} onSave={newChannel} onClose={() => setShowNew(false)} />
        </DialogContent>
      </Dialog>

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 grid gap-2 w-80">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${t.isError ? "border-destructive/50 bg-destructive text-destructive-foreground" : "bg-background text-foreground"}`}>
            {t.isError ? <X className="size-3" /> : <Check className="size-3" />} {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
