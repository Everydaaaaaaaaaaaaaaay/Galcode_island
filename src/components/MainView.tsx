// 三栏布局的中栏：流式区 + Pet/Bubble/ResultCard。
//
// 项目导航 / agent 切换 / 项目路径选择 都在左栏 SidebarLeft 接管，
// 所以中栏不再放 header，全部空间留给流式区。

import { AnimatePresence, motion } from "framer-motion";
import { useActiveTab } from "../hooks/useActiveTab";
import { PetCharacter } from "./pet-character/PetCharacter";

import { InputBubble } from "./chat-bubble/InputBubble";
import { ResultCard } from "./chat-bubble/ResultCard";
import { RunningBubble } from "./chat-bubble/RunningBubble";
import { StatusMonitor } from "./status-monitor/StatusMonitor";

export function MainView(): JSX.Element {
  const tab = useActiveTab();
  const uiState = tab.uiState;
  const mode = tab.mode;
  const cliBlockCount = tab.cliBlocks.length;
  // 完成后保留 StatusMonitor 让 BlockStream 历史可见，跟 ResultCard 共存。
  const showStatus =
    uiState === "running" ||
    mode === "working" ||
    mode === "thinking" ||
    cliBlockCount > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.42, ease: "easeOut" }}
      className="flex h-full w-full flex-col gap-3 px-4 pb-3 pt-7"
    >
      {/* Status Monitor Section —— flex-1 + min-h-0 让它在 turn 期间占满中部空间,
          BlockStream 在内部能拿到足够高度显示流式块 */}
      <AnimatePresence mode="popLayout">
        {showStatus && (
          <motion.div
            key="status-monitor"
            initial={{ opacity: 0, height: 0, scale: 0.98 }}
            animate={{ opacity: 1, height: "auto", scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.98 }}
            transition={{ duration: 0.3 }}
            className="flex flex-1 min-h-0 flex-col overflow-hidden"
          >
            <StatusMonitor />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 没在跑时给个弹簧保证 PetCharacter 在底部；跑起来时 StatusMonitor 已经
          flex-1 占空间，这个 spacer 会被压缩掉 */}
      {!showStatus && <div className="flex-1" />}

      {/* Pet & Bubble Interaction Area */}
      <div className="flex w-full items-end gap-3 relative min-h-[220px]">
        <div className="shrink-0">
          <PetCharacter />
        </div>

        <div className="flex-1 w-full translate-y-3">
          <AnimatePresence mode="wait">
            {uiState === "idle" && (mode === "idle" || !mode) && (
              <InputBubble key="input-bubble" />
            )}

            {showStatus && uiState !== "done" && uiState !== "error" && (
              <RunningBubble key="running-bubble" />
            )}

            {(uiState === "done" || uiState === "error" || mode === "complete" || mode === "suggestion" || mode === "error") && (
              <ResultCard key="result-card" />
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
}
