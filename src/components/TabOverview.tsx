import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Users, Activity } from "lucide-react";
import { type ServerState, type ChannelInfo, clientUrl, backendUrl, pluginYaml, copyText } from "@/lib/utils";

interface Props {
  state: ServerState | null;
  channel: ChannelInfo | null;
  toast: (msg: string, isError?: boolean) => void;
}

export function TabOverview({ state, channel, toast }: Props) {
  if (!channel) return null;
  const doCp = (l: string, v: string) => copyText(v).then(() => toast(`已复制 ${l}`)).catch(() => toast("复制失败", true));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle>Backend</CardTitle>
            <span className={`inline-block size-2 rounded-full ${channel.backendConnected ? "bg-emerald-500" : "bg-zinc-300"}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{channel.backendConnected ? "在线" : "离线"}</div>
            <p className="text-xs text-muted-foreground">{channel.instanceId || "未连接"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle>用户</CardTitle>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{channel.userCount || 0}</div>
            <p className="text-xs text-muted-foreground">已配置用户数</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle>客户端</CardTitle>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{channel.clientCount || 0}</div>
            <p className="text-xs text-muted-foreground">当前在线</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle>客户端地址</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => doCp("客户端地址", clientUrl(state, channel))}><Copy className="size-4" /></Button>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{clientUrl(state, channel)}</code>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle>Backend URL</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => doCp("Backend URL", backendUrl(state))}><Copy className="size-4" /></Button>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{backendUrl(state)}</code>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>插件配置 (openclaw.json)</CardTitle>
          <Button variant="ghost" size="icon" onClick={() => doCp("插件配置", pluginYaml(state, channel))}><Copy className="size-4" /></Button>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-md bg-zinc-950 px-4 py-3 font-mono text-xs leading-6 text-zinc-100">{pluginYaml(state, channel)}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
