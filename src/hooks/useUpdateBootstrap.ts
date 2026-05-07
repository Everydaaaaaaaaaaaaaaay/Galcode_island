// 启动后台检查更新。仅 Tauri 桌面端跑：
//   - 应用 mount 后等 8s（避开启动期密集 IPC：reattach / list_sessions / hydrate）
//   - 调一次 useUpdateStore.check(true)（autoTriggered=true，找不到新版静默不弹）
//   - 找到新版 store 自动 modalOpen=true → UpdateModal 显示
//
// 不做轮询。用户主动检查走 SettingsModal 里的 UpdatePanel。

import { useEffect } from "react";
import { isTauri } from "../lib/bridge";
import { useUpdateStore } from "../stores/useUpdateStore";

const BOOT_CHECK_DELAY_MS = 8000;

export function useUpdateBootstrap(): void {
  useEffect(() => {
    if (!isTauri) return;
    const timer = window.setTimeout(() => {
      void useUpdateStore.getState().check(true);
    }, BOOT_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
}
