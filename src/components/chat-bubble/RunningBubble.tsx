import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { useActiveTab, useActiveTabActions } from "../../hooks/useActiveTab";
import { useAppStore } from "../../stores/useAppStore";

export function RunningBubble(): JSX.Element {
  const tab = useActiveTab();
  const { activeTabId, reset } = useActiveTabActions();
  const addLogEntry = useAppStore((s) => s.addLogEntry);
  const bubble = tab.bubble;
  const uiState = tab.uiState;
  const mode = tab.mode;
  const isVisible = uiState === "running" || mode === "thinking" || mode === "working";

  const handleStop = async (): Promise<void> => {
    try {
      await invoke("stop_agent", {
        runId: activeTabId,
        sessionId: tab.sessionId,
      });
      reset();
      addLogEntry({ timestamp: Date.now(), level: "info", message: "已停止当前 tab 的 Agent。" });
    } catch (err) {
      addLogEntry({ timestamp: Date.now(), level: "error", message: `stop: ${String(err)}` });
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="running-bubble"
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ type: "spring", damping: 22, stiffness: 280 }}
          className="relative w-full overflow-hidden rounded-2xl rounded-bl-sm p-[2px] shadow-lg shadow-amber-500/10 dark:shadow-none"
        >
          {/* Faint amber base layer */}
          <div className="absolute inset-0 bg-amber-100/50 dark:bg-amber-400/10" />

          {/* Spinning conic gradient glow — longer visible arc in light mode */}
          <div className="absolute top-[-50%] left-[-50%] h-[200%] w-[200%] animate-[spin_4s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_60%,#fb923c_100%)] dark:bg-[conic-gradient(from_0deg,transparent_75%,#fb923c_100%)]" />

          {/* Inner glass content container */}
          <div className="relative flex h-full w-full flex-col rounded-[14px] border border-white/60 bg-white/70 p-4 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-800/60">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)] animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                Agent正在全力执行...
              </span>
              <button
                type="button"
                onClick={() => void handleStop()}
                className="ml-auto flex h-6 items-center rounded-md bg-rose-400/15 px-2 text-[11px] font-medium text-rose-500 transition-all hover:-translate-y-0.5 hover:bg-rose-400/25 dark:text-rose-300"
              >
                停止
              </button>
            </div>
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
              {bubble || "脑电波同步中..."}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
