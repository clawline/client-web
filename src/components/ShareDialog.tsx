import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import QRCode from "qrcode";
import { type ServerState, type ChannelInfo, type UserInfo, connectionUrl, clientFullUrl, copyText } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  state: ServerState | null;
  channel: ChannelInfo | null;
  user: UserInfo | null;
  toast: (msg: string, isError?: boolean) => void;
}

export function ShareDialog({ open, onClose, state, channel, user, toast }: Props) {
  const [qr, setQr] = useState("");
  const url = open && channel && user ? connectionUrl(state, channel, user) : "";

  useEffect(() => {
    if (!url) { setQr(""); return; }
    let cancelled = false;
    QRCode.toDataURL(url, { width: 280, margin: 1, errorCorrectionLevel: "M" })
      .then(d => { if (!cancelled) setQr(d); })
      .catch(() => { if (!cancelled) setQr(""); });
    return () => { cancelled = true; };
  }, [url]);

  if (!user) return null;

  const doCp = (label: string, value: string) => {
    copyText(value).then(() => { toast(`已复制 ${label}`); onClose(); }).catch(() => toast("复制失败", true));
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>分享 — {user.senderId}</DialogTitle>
          <DialogDescription>扫码或复制连接包即可登录</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex justify-center rounded-lg border bg-muted/30 p-6">
            {qr
              ? <img src={qr} alt="QR" className="h-52 w-52 rounded-md" />
              : <div className="grid h-52 w-52 place-items-center text-sm text-muted-foreground">生成中...</div>}
          </div>
          <div className="rounded-md bg-muted p-3">
            <code className="block break-all font-mono text-xs text-muted-foreground">{url}</code>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => doCp("连接包", url)}>复制连接包</Button>
            <Button variant="outline" className="flex-1" onClick={() => doCp("WSS URL", clientFullUrl(state, channel, user))}>复制 WSS URL</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
