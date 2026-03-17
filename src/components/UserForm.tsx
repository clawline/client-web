import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { randomToken, type UserInfo } from "@/lib/utils";

interface UserFormData {
  id: string; senderId: string; chatId: string; token: string;
  allowAgents: string; enabled: boolean;
}

interface Props {
  user: UserInfo | null;
  onSave: (data: UserFormData) => void;
  onClose: () => void;
}

export type { UserFormData };

export function UserForm({ user, onSave, onClose }: Props) {
  const [data, setData] = useState<UserFormData>({
    id: user?.id || "", senderId: user?.senderId || "", chatId: user?.chatId || "",
    token: user?.token || `gc_${randomToken()}`,
    allowAgents: Array.isArray(user?.allowAgents) ? user.allowAgents.join(",") : "",
    enabled: user?.enabled !== false,
  });
  const set = (k: keyof UserFormData, v: string) => setData(p => ({ ...p, [k]: v }));
  const submit = (e: FormEvent) => { e.preventDefault(); onSave(data); };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label>Sender ID *</Label><Input value={data.senderId} onChange={e => set("senderId", e.target.value)} placeholder="user-01" required /></div>
        <div className="grid gap-2"><Label>User ID</Label><Input value={data.id} onChange={e => set("id", e.target.value)} placeholder="可选" /></div>
      </div>
      <div className="grid gap-2">
        <Label>Token</Label>
        <div className="flex gap-2">
          <Input className="flex-1 font-mono" value={data.token} onChange={e => set("token", e.target.value)} autoComplete="new-password" />
          <Button variant="outline" size="sm" type="button" onClick={() => set("token", `gc_${randomToken()}`)}>生成</Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><Label>固定 Chat ID</Label><Input value={data.chatId} onChange={e => set("chatId", e.target.value)} placeholder="可选" /></div>
        <div className="grid gap-2"><Label>允许 Agents</Label><Input value={data.allowAgents} onChange={e => set("allowAgents", e.target.value)} placeholder="* 或 main,code" /></div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="rounded border-input" checked={data.enabled} onChange={e => setData(p => ({ ...p, enabled: e.target.checked }))} /> 启用
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>取消</Button>
        <Button type="submit">保存</Button>
      </div>
    </form>
  );
}
