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
      // 桌面端 pt-7 给 SidebarLeft 顶部 28px drag bar 留位置；移动端没 drag bar
      // 由 MobileTopBar sticky 占位，MainView 直接从 pt-2 起步即可。
      // pb 移动端额外加 env(safe-area-inset-bottom) 给 iPhone home indicator 让位
      // —— 否则卡片底部输入框会被刘海/底栏遮挡。
      className="flex h-full w-full flex-col gap-2 px-2 pt-2 sm:gap-3 sm:px-4 sm:pt-3 lg:pt-7"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {/* Status Monitor —— 桌面端 + 移动端都显示（flex-1 min-h-0 占主区上半部分）。
          BlockStream 内部 overflow-y-auto 滚动展示流式块。 */}
      <AnimatePresence mode="popLayout">
        {showStatus && (
          <motion.div
            key="status-monitor"
            initial={{ opacity: 0, height: 0, scale: 0.98 }}
            animate={{ opacity: 1, height: "auto", scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.98 }}
            transition={{ duration: 0.3 }}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <StatusMonitor />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 没在跑且没历史块时给弹簧让桌宠 + 气泡浮在底部；
          有 status 时 StatusMonitor 已经 flex-1 占空间，spacer 不渲染 */}
      {!showStatus && <div className="flex-1" />}

      {/* Pet & Bubble Interaction Area —— shrink-0 自然高度，不抢 StatusMonitor 空间。
          桌面端：外层桌宠 + 气泡横排；移动端：外层桌宠隐藏（嵌入卡片头部）。
          卡片内部 summary 自带 max-h-[35vh] cap，避免长内容撑爆。 */}
      <div className="relative flex w-full shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-end sm:gap-3 sm:min-h-[220px]">
        <div className="hidden shrink-0 sm:block">
          <PetCharacter />
        </div>

        <div className="flex w-full flex-col sm:flex-1 sm:translate-y-3">
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
