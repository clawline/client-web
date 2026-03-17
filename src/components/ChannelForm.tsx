import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pickAnimal, randomToken, type ChannelInfo } from "@/lib/utils";

interface Props {
  channel: ChannelInfo | null;
  onSave: (data: { channelId: string; label: string; secret: string; tokenParam: string }) => void;
  onClose: () => void;
}

export function ChannelForm({ channel, onSave, onClose }: Props) {
  const isNew = !channel;
  const [an] = useState(() => pickAnimal());
  const [data, setData] = useState(() => {
    if (channel) return { channelId: channel.channelId, label: channel.label || "", secret: channel.secret || "", tokenParam: channel.tokenParam || "token" };
    const slug = `gc-${an[1]}-${randomToken().slice(0, 6)}`;
    return { channelId: slug, label: `${an[0]} ${an[1].charAt(0).toUpperCase() + an[1].slice(1)}`, secret: randomToken(), tokenParam: "token" };
  });
  const [adv, setAdv] = useState(false);
  const set = (k: keyof typeof data, v: string) => setData(p => ({ ...p, [k]: v }));
  const submit = (e: FormEvent) => { e.preventDefault(); onSave(data); };

  if (isNew && !adv) {
    return (
      <form className="grid gap-4" onSubmit={submit}>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-4">
          <span className="text-4xl">{an[0]}</span>
          <div className="flex-1 grid gap-2">
            <Label>服务器名称</Label>
            <Input value={data.label} onChange={e => set("label", e.target.value)} placeholder="给服务器起个名字" required autoFocus />
          </div>
        </div>
        <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">channelId: {data.channelId}</div>
        <div className="flex items-center justify-between">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => setAdv(true)}>高级设置 →</button>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={onClose}>取消</Button>
            <Button type="submit">创建</Button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2"><Label>Channel ID</Label><Input className="font-mono" value={data.channelId} onChange={e => set("channelId", e.target.value)} required /></div>
      <div className="grid gap-2"><Label>名称</Label><Input value={data.label} onChange={e => set("label", e.target.value)} /></div>
      <div className="grid gap-2">
        <Label>Backend Secret</Label>
        <div className="flex gap-2">
          <Input className="flex-1 font-mono" value={data.secret} onChange={e => set("secret", e.target.value)} autoComplete="new-password" />
          <Button variant="outline" size="sm" type="button" onClick={() => set("secret", randomToken())}>生成</Button>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>取消</Button>
        <Button type="submit">保存</Button>
      </div>
    </form>
  );
}
