// 把当前 useTabsStore 的项目列表 + 状态以精简快照定期推到 Rust 后端。
// 后端 HTTP /api/projects 会读这份镜像 → 移动端能看到桌面端的项目和状态。
//
// 触发条件：
//   - 启动时立即推一次（保证移动端登录后能看到项目）
//   - 每 6s 推一次（活跃同步周期；快到能看到状态变化但慢到不烧 IPC）
//   - tabs/order/activeTabId 变化立刻推（用 zustand subscribe）
//
// 推送的 item 字段对应 Rust ProjectSnapshotItem（rename_all=camelCase），保持一致。

import { useEffect } from "react";
import { invoke, isTauri } from "../lib/bridge";
import { useTabsStore, type TabState } from "../stores/useTabsStore";
import { useLanStore } from "../stores/useLanStore";

interface SnapshotItem {
  id: string;
  title: string;
  agent: string;
  projectPath: string | null;
  lastUserPrompt: string | null;
  lastActiveAt: number;
  createdAt: number;
  status: string;
  uiState: string;
  sessionId: string | null;
  agentNativeSessionId: string | null;
  hasUnread: boolean;
}

function tabToSnapshot(tab: TabState): SnapshotItem {
  return {
    id: tab.id,
    title: tab.title || "新会话",
    agent: tab.agent,
    projectPath: tab.projectPath,
    lastUserPrompt: tab.lastUserPrompt,
    // Rust 端用 unix 秒，前端是 ms — 转一下
    lastActiveAt: Math.floor((tab.lastActiveAt || tab.createdAt) / 1000),
    createdAt: Math.floor(tab.createdAt / 1000),
    status: tab.agentStatus || "idle",
    uiState: tab.uiState || "idle",
    sessionId: tab.sessionId,
    agentNativeSessionId: tab.agentNativeSessionId,
    hasUnread: tab.hasUnread,
  };
}

async function syncOnce(): Promise<void> {
  const lan = useLanStore.getState();
  // 服务没在跑就别白忙：refresh 后能拿到 running，但首次加载前 state 是 null,
  // 这种场景下也直接返回不调 IPC（reduces noise）
  if (!lan.state?.running) return;
  const tabs = useTabsStore.getState();
  const items = tabs.order
    .map((id) => tabs.tabs[id])
    .filter(Boolean)
    .map(tabToSnapshot);
  try {
    await invoke("lan_sync_projects", {
      items,
      activeTabId: tabs.activeTabId,
    });
  } catch (err) {
    // 不打印过多噪音 —— 配置错误等会从 SettingsModal 看到
    console.warn("[lan-sync] failed", err);
  }
}

export function useLanProjectsSync(): void {
  useEffect(() => {
    // 仅桌面端推 tabs 快照到后端：浏览器端是消费方（HTTP /api 已经聚合后端 sessions
    // 与桌面端推上来的快照），自己再推一遍只会用空 zustand 覆盖真正的真相。
    if (!isTauri) return;

    // 启动时拉一次后端状态，确认服务是否在跑
    void useLanStore.getState().refresh();

    // 立即同步 + 周期同步
    void syncOnce();
    const timer = window.setInterval(() => {
      void syncOnce();
    }, 6000);

    // tabs / activeTab 变化时主动推一次（debounce 200ms 合并连续变化）
    let debounce: number | null = null;
    const unsub = useTabsStore.subscribe(() => {
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        debounce = null;
        void syncOnce();
      }, 200);
    });

    return () => {
      window.clearInterval(timer);
      if (debounce) window.clearTimeout(debounce);
      unsub();
    };
  }, []);
}
