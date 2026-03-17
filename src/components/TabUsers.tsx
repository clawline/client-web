import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Share2 } from "lucide-react";
import { UserForm, type UserFormData } from "./UserForm";
import { ShareDialog } from "./ShareDialog";
import { type ServerState, type ChannelInfo, type UserInfo, api, copyText } from "@/lib/utils";

interface Props {
  state: ServerState | null;
  channel: ChannelInfo | null;
  token: string;
  onReload: () => Promise<void>;
  toast: (msg: string, isError?: boolean) => void;
}

export function TabUsers({ state, channel, token, onReload, toast }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<UserInfo | null>(null);
  const [shareUser, setShareUser] = useState<UserInfo | null>(null);

  if (!channel) return null;
  const users = Array.isArray(channel.users) ? channel.users : [];

  const saveUser = async (d: UserFormData) => {
    try {
      await api(`/api/channels/${encodeURIComponent(channel.channelId)}/users`, token, { method: "POST", body: JSON.stringify(d) });
      toast(`已保存 ${d.senderId}`);
      setShowForm(false);
      setEditUser(null);
      await onReload();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "保存失败", true);
    }
  };

  const deleteUser = async (u: UserInfo) => {
    if (!confirm(`删除 ${u.senderId}？`)) return;
    try {
      await api(`/api/channels/${encodeURIComponent(channel.channelId)}/users/${encodeURIComponent(u.senderId)}`, token, { method: "DELETE" });
      toast(`已删除 ${u.senderId}`);
      await onReload();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "删除失败", true);
    }
  };

  const doCp = (l: string, v: string) => copyText(v).then(() => toast(`已复制 ${l}`)).catch(() => toast("复制失败", true));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">用户管理</h3>
          <p className="text-sm text-muted-foreground">{users.length} 个用户</p>
        </div>
        <Button size="sm" onClick={() => { setEditUser(null); setShowForm(true); }}>
          <Plus className="size-4" /> 新建
        </Button>
      </div>

      {users.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">暂无用户</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { setEditUser(null); setShowForm(true); }}>
            <Plus className="size-4" /> 创建第一个用户
          </Button>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sender ID</TableHead>
                <TableHead className="hidden sm:table-cell">Token</TableHead>
                <TableHead className="hidden md:table-cell">Agents</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => {
                const ag = Array.isArray(u.allowAgents) && u.allowAgents.length ? u.allowAgents.join(", ") : "*";
                return (
                  <TableRow key={u.senderId}>
                    <TableCell className="font-medium">{u.senderId}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <code className="cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted/80 transition-colors"
                        onClick={() => doCp("token", u.token)}>
                        {u.token.slice(0, 14)}…
                      </code>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{ag}</TableCell>
                    <TableCell>
                      <Badge variant={u.enabled !== false ? "secondary" : "destructive"}>
                        {u.enabled !== false ? "启用" : "停用"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="分享" onClick={() => setShareUser(u)}><Share2 className="size-4" /></Button>
                        <Button variant="ghost" size="icon" title="编辑" onClick={() => { setEditUser(u); setShowForm(true); }}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" title="删除" className="text-destructive hover:text-destructive" onClick={() => deleteUser(u)}><Trash2 className="size-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); setEditUser(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editUser ? `编辑 ${editUser.senderId}` : "新建用户"}</DialogTitle>
            <DialogDescription>配置用户身份和访问权限</DialogDescription>
          </DialogHeader>
          <UserForm user={editUser} onSave={saveUser} onClose={() => { setShowForm(false); setEditUser(null); }} />
        </DialogContent>
      </Dialog>

      <ShareDialog open={!!shareUser} onClose={() => setShareUser(null)} state={state} channel={channel} user={shareUser} toast={toast} />
    </div>
  );
}
