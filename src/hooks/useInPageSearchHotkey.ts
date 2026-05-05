// 全局快捷键：Cmd+F (mac) / Ctrl+F (Win/Linux) → 在当前 active tab 的范围内
// 打开页内搜索浮窗；Esc 关闭。
//
// 阻止浏览器自带的"页面查找"行为：preventDefault 后 Tauri WebView 不会弹
// 浏览器搜索条。

import { useEffect } from "react";
import { useAppStore } from "../stores/useAppStore";
import { useUiStore } from "../stores/useUiStore";

export function useInPageSearchHotkey(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const isFindKey = (e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F");
      if (!isFindKey) return;

      // 没启动主界面（WelcomeView 阶段）没什么可搜的，直接放掉；让浏览器
      // 自己处理 — 在 Tauri WebView 里也无害
      if (!useAppStore.getState().isStarted) return;

      const { inPageSearchOpen, openInPageSearch } = useUiStore.getState();

      // 用户在某个 input/textarea 里按 cmd+f：仍然打开 — 这是更符合 IDE 直觉
      // 的行为（VS Code / 浏览器都是这样），抢过焦点不影响输入框本身的 value
      e.preventDefault();
      if (!inPageSearchOpen) openInPageSearch();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
