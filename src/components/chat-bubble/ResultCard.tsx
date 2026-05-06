import { invoke } from "@tauri-apps/api/core";
import { useRef, useState, type KeyboardEvent } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { useTabsStore } from "../../stores/useTabsStore";
import { useActiveTab, useActiveTabActions } from "../../hooks/useActiveTab";
import { motion, AnimatePresence } from "framer-motion";

export function ResultCard(): JSX.Element {
  const tab = useActiveTab();
  const { activeTabId, update } = useActiveTabActions();
  const addLogEntry = useAppStore((s) => s.addLogEntry);

  const mode = tab.mode;
  const uiState = tab.uiState;
  const emotionText = tab.emotionText;
  const summaryTranslation = tab.summaryTranslation;
  const suggestionOptions = tab.suggestionOptions;

  // ResultCard 内嵌的"继续追问"输入框 —— 跟选项按钮并存，让用户能直接打字而不必
  // 等回 InputBubble。组件态而非 tab.task：tab.task 是 InputBubble 的草稿，
  // 跟这里语义独立。
  const [followupText, setFollowupText] = useState("");
  // 中文输入法 composition 期间不要把 Enter 当发送 —— 用 keydown 检查 isComposing
  // 即可（Safari/Chrome/Edge 都支持）；composition* 事件做 backup 兜底。
  const isComposingRef = useRef(false);

  const isVisible =
    uiState === "done" ||
    uiState === "error" ||
    mode === "complete" ||
    mode === "suggestion" ||
    mode === "error";

  /// 点选项 = 立即启动新一轮（不回 idle，避免 InputBubble 还没显示就把上一轮的
  /// 状态条都清掉造成"白屏"）。仍然在同一个 tab 内继续。
  /// **不清 cliBlocks** —— 单项目多轮会话累积保留；上一轮结果字段也保留，
  /// 新 turn 完成时被新的 session-complete 事件覆盖（RunningBubble 期间显示中）。
  const handleOptionClick = async (opt: string): Promise<void> => {
    if (!activeTabId) return;
    // backend native session id 作 resume hint（Claude CLI session / Codex thread /
    // OpenCode session），让上下文延续；前端 sessionId 是 AgentSession UUID 不能用
    const resumeHint = tab.agentNativeSessionId;
    update({
      task: opt,
      percent: 0,
      uiState: "running",
      mode: "working",
      agentStatus: "running",
      lastUserPrompt: opt.slice(0, 80),
      lastActiveAt: Date.now(),
    });
    // 流式区追加用户消息气泡，跟 InputBubble 启动路径行为一致
    useTabsStore.getState().appendCliBlock(activeTabId, {
      id: `user-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "user-prompt",
      content: opt,
    });

    try {
      const res = await invoke<{ sessionId?: string }>("start_agent", {
        userInputZh: opt,
        cwd: tab.projectPath || ".",
        agent: tab.agent,
        runId: activeTabId,
        sessionId: resumeHint,
      });
      if (res?.sessionId) update({ sessionId: res.sessionId });
    } catch (err) {
      addLogEntry({
        timestamp: Date.now(),
        level: "error",
        message: `launch err: ${String(err)}`,
      });
      update({
        uiState: "error",
        mode: "error",
        agentStatus: "error",
      });
    }
  };

  const submitFollowup = (): void => {
    const text = followupText.trim();
    if (!text) return;
    setFollowupText("");
    void handleOptionClick(text);
  };

  const handleFollowupKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== "Enter") return;
    // shift+Enter 让默认行为生效（插入换行）
    if (e.shiftKey) return;
    // IME 候选词期间按 Enter 是选词，不能截走当发送：
    //   - e.nativeEvent.isComposing 是现代浏览器标准
    //   - keyCode 229 是 IME 阶段的兜底标记
    //   - isComposingRef 双保险（个别老 WebView 不报 isComposing 但有 composition 事件）
    const native = e.nativeEvent as KeyboardEvent["nativeEvent"] & { isComposing?: boolean };
    if (native.isComposing || e.keyCode === 229 || isComposingRef.current) return;
    e.preventDefault();
    submitFollowup();
  };

  const isError = mode === "error" || uiState === "error";
  const headerColor = isError ? "text-rose-500 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400";

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="result-card"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ type: "spring", damping: 22, stiffness: 280 }}
          className="relative w-full rounded-2xl shadow-lg shadow-amber-500/10 dark:shadow-none"
        >
          {/* 真·环绕光效：背景 conic-gradient 的 from 角度做动画（用 @property
              --glow-angle），div 形状本身不旋转 —— mask 切出的圆角边框稳套外层，
              光段在边框上平滑滑动一圈。详细 CSS 在 index.css `.glow-frame`。 */}
          <div aria-hidden="true" className="glow-frame rounded-2xl" />

          {/* Inner glass content container */}
          <div className="relative flex h-full w-full flex-col gap-3 rounded-2xl border border-white/60 bg-white/70 p-4 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-800/60">
            {/* Header */}
            <div className="flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full ${isError ? "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.5)]" : "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"} animate-pulse`} />
              <span className={`text-sm font-extrabold uppercase tracking-widest ${headerColor}`}>
                {mode || "COMPLETE"}
              </span>
            </div>

            {/* Emotion Speech */}
            {emotionText && (
              <div className="relative rounded-t-2xl rounded-br-2xl rounded-bl-sm border border-white/50 bg-white/70 p-4 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-700/60">
                <p className="text-[15px] font-bold leading-snug text-zinc-800 dark:text-zinc-100">
                  {emotionText}
                </p>
              </div>
            )}

            {/* Summary */}
            {summaryTranslation && (
              <div className="px-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                {summaryTranslation}
              </div>
            )}

            {/* Suggestion Options */}
            {suggestionOptions?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 pt-1 border-t border-zinc-200/50 dark:border-zinc-700/50">
                {suggestionOptions.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => void handleOptionClick(opt)}
                    className="flex items-center rounded-full border border-white/40 bg-white/50 px-3.5 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:text-zinc-900 hover:shadow-md active:translate-y-0 active:scale-95 dark:border-white/10 dark:bg-slate-700/50 dark:text-zinc-300 dark:hover:bg-slate-600 dark:hover:text-white"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {/* 永久输入框：除了选项按钮之外用户始终能直接打字继续会话 */}
            <div className="mt-2 flex items-end gap-2 border-t border-zinc-200/50 pt-2 dark:border-zinc-700/50">
              <textarea
                value={followupText}
                onChange={(e) => setFollowupText(e.target.value)}
                onKeyDown={handleFollowupKeyDown}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                placeholder="继续追问…  (Enter 发送，Shift+Enter 换行)"
                rows={1}
                className="min-h-[36px] max-h-32 flex-1 resize-y rounded-xl border border-black/5 bg-white/55 px-3 py-2 text-sm text-zinc-800 outline-none transition-all placeholder:text-zinc-400 focus:border-sky-400/50 focus:bg-white/85 focus:ring-2 focus:ring-sky-400/15 dark:border-white/5 dark:bg-slate-900/40 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-sky-400/40 dark:focus:bg-slate-900/60 dark:focus:ring-sky-400/10"
              />
              <button
                type="button"
                onClick={submitFollowup}
                disabled={!followupText.trim()}
                aria-label="发送"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-md shadow-sky-400/25 transition-all hover:bg-sky-600 hover:shadow-sky-400/40 active:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <path d="M2.5 8h11M9 3.5L13.5 8 9 12.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
