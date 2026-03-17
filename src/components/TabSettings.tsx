import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Pencil, Trash2 } from "lucide-react";
import { ChannelForm } from "./ChannelForm";
import { type ServerState, type ChannelInfo, api } from "@/lib/utils";

interface Props {
  state: ServerState | null;
  channel: ChannelInfo | null;
  token: string;
  onReload: () => Promise<void>;
  onDelete: () => void;
  toast: (msg: string, isError?: boolean) => void;
}

export function TabSettings({ channel, token, onReload, onDelete, toast }: Props) {
  const [editing, setEditing] = useState(false);
  if (!channel) return null;

  const save = async (d: { channelId: string; label: string; secret: string; tokenParam: string }) => {
    try {
      await api("/api/channels", token, { method: "POST", body: JSON.stringify(d) });
      toast(`已保存 ${d.channelId}`);
      setEditing(false);
      await onReload();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "保存失败", true);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">服务器设置</h3>
        <p className="text-sm text-muted-foreground">管理 Channel 配置</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          {editing ? (
            <ChannelForm channel={channel} onSave={save} onClose={() => setEditing(false)} />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Channel ID</Label>
                  <div className="font-mono text-sm">{channel.channelId}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground">名称</Label>
                  <div className="text-sm">{channel.label || "—"}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Secret</Label>
                  <div className="font-mono text-sm text-muted-foreground">{channel.secret ? `${channel.secret.slice(0, 8)}…` : "—"}</div>
                </div>
              </div>
              <Separator className="my-4" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> 编辑</Button>
                <Button variant="destructive" size="sm" onClick={onDelete}><Trash2 className="size-4" /> 删除服务器</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
