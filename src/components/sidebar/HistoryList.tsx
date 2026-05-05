// 左栏中部的"历史会话"视图：按 closedAt 倒序展示已归档的会话。
// 关闭 tab 时 useTabsStore.removeTab 会把核心元数据写进 history。
//
// 点击历史项 → restoreFromHistory 创建新 tab（沿用 projectPath / agent /
// sessionId / 上次结果），切到该 tab；该条目从 history 里移除。
// 右键 / hover × 删除单条；底部"清空"按钮删全部。

import { useMemo } from "react";
import { useTabsStore, type ArchivedSession } from "../../stores/useTabsStore";
import { useUiStore } from "../../stores/useUiStore";
import { useAppStore } from "../../stores/useAppStore";

function basename(p: string | null): string {
  if (!p) return "未选择目录";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function relativeTime(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

interface HistoryRowProps {
  item: ArchivedSession;
  onRestore: () => void;
  onDelete: () => void;
}

function HistoryRow({ item, onRestore, onDelete }: HistoryRowProps): JSX.Element {
  return (
    <div
      onClick={onRestore}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onDelete();
        }
      }}
      className="group relative cursor-pointer rounded-lg border border-white/40 bg-white/40 px-2.5 py-2 text-[11px] text-zinc-700 transition-all hover:bg-white/70 dark:border-white/10 dark:bg-zinc-800/40 dark:text-zinc-300 dark:hover:bg-zinc-800/65"
      role="button"
      title="点击恢复该会话到新 tab"
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium leading-tight" title={item.summary}>
            {item.summary}
          </div>
          <div className="mt-0.5 truncate text-[10px] tracking-wide text-zinc-400 dark:text-zinc-500">
            {basename(item.projectPath)} · {item.agent} · {relativeTime(item.closedAt)}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="从历史中删除"
        className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded text-zinc-400 opacity-0 transition-opacity hover:bg-rose-400/20 hover:text-rose-500 group-hover:opacity-100 dark:text-zinc-500 dark:hover:text-rose-400"
      >
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-2.5 w-2.5">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function HistoryList(): JSX.Element {
  const history = useTabsStore((s) => s.history);
  const restoreFromHistory = useTabsStore((s) => s.restoreFromHistory);
  const removeFromHistory = useTabsStore((s) => s.removeFromHistory);
  const clearHistory = useTabsStore((s) => s.clearHistory);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const setLeftSidebarView = useUiStore((s) => s.setLeftSidebarView);
  const setIsStarted = useAppStore((s) => s.setIsStarted);

  const sorted = useMemo(
    () => history.slice().sort((a, b) => b.closedAt - a.closedAt),
    [history],
  );

  const handleRestore = (id: string): void => {
    const newId = restoreFromHistory(id);
    if (newId) {
      setActiveTab(newId);
      // 恢复后切回 projects 视图，让用户立刻看到刚恢复的 tab
      setLeftSidebarView("projects");
      // 最后一个 tab 关闭后 isStarted 可能被置 false；现在又恢复出 tab 了，
      // 重新打开主界面
      setIsStarted(true);
    }
  };

  if (sorted.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
        还没有已关闭的会话
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
          已关闭 {sorted.length}
        </span>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("清空整个历史？此操作不可撤销。")) clearHistory();
          }}
          className="text-[10px] text-zinc-400 transition-colors hover:text-rose-500 dark:text-zinc-500 dark:hover:text-rose-400"
        >
          清空
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {sorted.map((item) => (
          <HistoryRow
            key={item.id}
            item={item}
            onRestore={() => handleRestore(item.id)}
            onDelete={() => removeFromHistory(item.id)}
          />
        ))}
      </div>
    </div>
  );
}
