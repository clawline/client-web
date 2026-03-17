import { Button } from "@/components/ui/button";
import { type ChannelInfo, animalIcon, timeAgo } from "@/lib/utils";
import { Plus, Server, Check, X } from "lucide-react";

interface ActivityItem { id: string; msg: string; isError: boolean; ts: number }

interface Props {
  channels: ChannelInfo[];
  selected: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  activity: ActivityItem[];
}

export type { ActivityItem };

export function Nav({ channels, selected, onSelect, onNew, activity }: Props) {
  return (
    <div className="flex h-full w-[220px] flex-col border-r bg-muted/40">
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold text-sm">
        <Server className="size-4" /> Relay Gateway
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 sb">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">服务器</div>
        {channels.map(ch => {
          const sel = ch.channelId === selected;
          return (
            <button key={ch.channelId} type="button" onClick={() => onSelect(ch.channelId)}
              className={`group mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${sel ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}>
              <span className="text-base leading-none">{animalIcon(ch.channelId)}</span>
              <span className="min-w-0 flex-1 truncate text-left">{ch.label || ch.channelId}</span>
              <span className="flex items-center gap-1.5">
                <span className={`inline-block size-2 rounded-full ${ch.backendConnected ? "bg-emerald-500" : "bg-zinc-300"}`} />
                <span className={`text-xs tabular-nums ${sel ? "text-primary-foreground/60" : "text-muted-foreground"}`}>{ch.userCount}</span>
              </span>
            </button>
          );
        })}
        {channels.length === 0 && <div className="px-2 py-8 text-center text-sm text-muted-foreground">暂无服务器</div>}
      </div>
      <div className="p-2">
        <Button variant="outline" className="w-full" size="sm" onClick={onNew}><Plus className="size-4" /> 新建</Button>
      </div>
      {activity.length > 0 && (
        <div className="border-t">
          <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">最近操作</div>
          <div className="max-h-40 overflow-y-auto px-2 pb-2 sb">
            {activity.map(a => (
              <div key={a.id} className="flex items-start gap-2 rounded-md px-2 py-1.5">
                <span className={`mt-0.5 ${a.isError ? "text-destructive" : "text-emerald-500"}`}>
                  {a.isError ? <X className="size-3" /> : <Check className="size-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs truncate">{a.msg}</div>
                  <div className="text-[10px] text-muted-foreground">{timeAgo(a.ts)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
