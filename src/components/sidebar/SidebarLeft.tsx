// 三栏布局的左栏：上下结构
//   - 顶部 28px drag bar：mac 上给 traffic lights 让位 + 整条可拖窗；
//     非 mac 上整条可拖 + 右侧嵌入 −/□/× 三连窗口控制按钮（GlobalTopBar 已删除，
//     窗口控制只能寄生在这里）
//   - 上：导航菜单（"所有项目" / "历史会话" / "搜索"切换中部视图）
//   - 中：按 useUiStore.leftSidebarView 切换显示 ProjectTree / HistoryList / SearchPanel
//   - 下：主题 / 设置 / 个人档案

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppStore } from "../../stores/useAppStore";
import { useUiStore } from "../../stores/useUiStore";
import { useTabsStore } from "../../stores/useTabsStore";
import { useProfileStore } from "../../stores/useProfileStore";
import { ProjectTree } from "./ProjectTree";
import { HistoryList } from "./HistoryList";
import { SearchPanel } from "./SearchPanel";

const isMacOS = typeof navigator !== "undefined"
  && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

interface MenuButtonProps {
  label: string;
  icon: JSX.Element;
  onClick?: () => void;
  active?: boolean;
}

function MenuButton({ label, icon, onClick, active }: MenuButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-[12px] font-medium transition-colors ${
        active
          ? "bg-sky-400/15 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200"
          : "text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-500 dark:text-zinc-400">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function SidebarLeft(): JSX.Element {
  const openSettingsModal = useSettingsStore((s) => s.openSettingsModal);
  const openProfileModal = useProfileStore((s) => s.openProfileModal);
  const profileNickname = useProfileStore((s) => s.nickname);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const leftSidebarView = useUiStore((s) => s.leftSidebarView);
  const setLeftSidebarView = useUiStore((s) => s.setLeftSidebarView);
  const historyCount = useTabsStore((s) => s.history.length);
  const appWindow = getCurrentWindow();

  const handleDragMouseDown = async (event: MouseEvent<HTMLDivElement>): Promise<void> => {
    if (event.button !== 0) return;
    try {
      await appWindow.startDragging();
    } catch (error) {
      console.error("Failed to start dragging window", error);
    }
  };

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-black/5 bg-white/35 backdrop-blur-md dark:border-white/5 dark:bg-zinc-900/30">
      {/* 顶部 28px drag/控制条 —— 替代被删掉的 GlobalTopBar */}
      <div className="flex h-7 shrink-0 items-center">
        {/* mac 左侧 ~72px 给 traffic lights，让红绿灯不挡其它内容 */}
        {isMacOS && <div className="h-full w-[72px] shrink-0" />}
        <div
          data-tauri-drag-region
          onMouseDown={(event) => { void handleDragMouseDown(event); }}
          className="h-full flex-1"
        />
        {!isMacOS && (
          <div className="flex items-center gap-0.5 pr-1">
            <button
              type="button"
              onClick={async () => {
                try { await appWindow.minimize(); }
                catch (error) { console.error("Failed to minimize", error); }
              }}
              className="flex h-5 w-6 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-black/10 dark:text-zinc-400 dark:hover:bg-white/10"
              aria-label="最小化窗口"
            >
              -
            </button>
            <button
              type="button"
              onClick={async () => {
                try { await appWindow.toggleMaximize(); }
                catch (error) { console.error("Failed to toggle maximize", error); }
              }}
              className="flex h-5 w-6 items-center justify-center rounded text-[10px] text-zinc-500 transition-colors hover:bg-black/10 dark:text-zinc-400 dark:hover:bg-white/10"
              aria-label="最大化窗口"
            >
              □
            </button>
            <button
              type="button"
              onClick={async () => {
                try { await appWindow.close(); }
                catch (error) { console.error("Failed to close", error); }
              }}
              className="flex h-5 w-6 items-center justify-center rounded text-rose-500 transition-colors hover:bg-rose-400/15 dark:text-rose-300"
              aria-label="关闭窗口"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* 顶部菜单 */}
      <div className="flex flex-col gap-0.5 border-b border-black/5 px-2 py-2 dark:border-white/5">
        <MenuButton
          label="所有项目"
          active={leftSidebarView === "projects"}
          onClick={() => setLeftSidebarView("projects")}
          icon={
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
              <path d="M2 4h6l1 1.5h5v6.5a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
            </svg>
          }
        />
        <MenuButton
          label={historyCount > 0 ? `历史会话 (${historyCount})` : "历史会话"}
          active={leftSidebarView === "history"}
          onClick={() => setLeftSidebarView("history")}
          icon={
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5v3l2 1.5" strokeLinecap="round" />
            </svg>
          }
        />
        <MenuButton
          label="搜索"
          active={leftSidebarView === "search"}
          onClick={() => setLeftSidebarView("search")}
          icon={
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L13.5 13.5" strokeLinecap="round" />
            </svg>
          }
        />
      </div>

      {/* 中部按 view 切换 */}
      {leftSidebarView === "history" ? (
        <HistoryList />
      ) : leftSidebarView === "search" ? (
        <SearchPanel />
      ) : (
        <ProjectTree />
      )}

      {/* 底部菜单 */}
      <div className="flex flex-col gap-0.5 border-t border-black/5 px-2 py-2 dark:border-white/5">
        <MenuButton
          label={theme === "dark" ? "切换浅色" : "切换深色"}
          onClick={toggleTheme}
          icon={
            theme === "dark" ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
                <circle cx="8" cy="8" r="3" />
                <path
                  strokeLinecap="round"
                  d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.5 3.5l-1 1M4.5 11.5l-1 1M12.5 12.5l-1-1M4.5 4.5l-1-1"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
                <path d="M14 8.5A6 6 0 117.5 2a4.5 4.5 0 006.5 6.5z" strokeLinejoin="round" />
              </svg>
            )
          }
        />
        <MenuButton
          label="设置"
          onClick={openSettingsModal}
          icon={
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.9 2.2c.3-1.2 2-1.2 2.2 0a1.1 1.1 0 001.7.7c1-.6 2.2.6 1.6 1.6a1.1 1.1 0 00.7 1.7c1.2.3 1.2 2 0 2.2a1.1 1.1 0 00-.7 1.7c.6 1-.6 2.2-1.6 1.6a1.1 1.1 0 00-1.7.7c-.3 1.2-2 1.2-2.2 0a1.1 1.1 0 00-1.7-.7c-1 .6-2.2-.6-1.6-1.6a1.1 1.1 0 00-.7-1.7c-1.2-.3-1.2-2 0-2.2a1.1 1.1 0 00.7-1.7c-.6-1 .6-2.2 1.6-1.6.7.4 1.5.1 1.7-.7z"
              />
              <circle cx="8" cy="8" r="2" />
            </svg>
          }
        />
        <MenuButton
          label={profileNickname.trim() ? `个人档案 · ${profileNickname.slice(0, 8)}` : "个人档案"}
          onClick={openProfileModal}
          icon={
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
              <circle cx="8" cy="6" r="2.5" />
              <path d="M3 13c0-2.4 2.2-4 5-4s5 1.6 5 4" strokeLinecap="round" />
            </svg>
          }
        />
      </div>
    </aside>
  );
}
