// 自动更新弹窗。
//
// 由 useUpdateStore 驱动，根据 status 切换不同视图：
//   - available：版本号 + 发布日期 + release notes（markdown） + [立即更新 / 稍后]
//   - downloading：进度条 + "正在下载…"
//   - ready：完成 + [立即重启] / [稍后重启]
//   - up-to-date：已是最新（仅手动检查时弹）
//   - error：错误信息 + [重试 / 关闭]
//
// modal 视觉跟 SettingsModal 同款 sheet 风格：桌面端居中弹窗，移动端底部 sheet。

import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useUpdateStore } from "../../stores/useUpdateStore";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatBytes(n: number): string {
  if (!n || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function UpdateModal(): JSX.Element {
  const status = useUpdateStore((s) => s.status);
  const update = useUpdateStore((s) => s.update);
  const progress = useUpdateStore((s) => s.progress);
  const errorMessage = useUpdateStore((s) => s.errorMessage);
  const modalOpen = useUpdateStore((s) => s.modalOpen);

  const dismiss = useUpdateStore((s) => s.dismiss);
  const install = useUpdateStore((s) => s.install);
  const relaunch = useUpdateStore((s) => s.relaunch);
  const check = useUpdateStore((s) => s.check);

  const downloadingLocked = status === "downloading";
  const percent = progress && progress.total > 0
    ? Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))
    : null;

  return (
    <AnimatePresence>
      {modalOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[250] bg-black/30 backdrop-blur-sm"
            onClick={() => !downloadingLocked && dismiss()}
          />

          <div className="fixed inset-0 z-[260] flex items-end justify-center pointer-events-none sm:items-center">
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="pointer-events-auto flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-white/60 bg-white/90 shadow-[0_-10px_40px_rgba(0,0,0,0.18)] backdrop-blur-2xl sm:max-h-[80vh] sm:w-[92%] sm:max-w-lg sm:rounded-2xl sm:bg-white/80 sm:shadow-[0_20px_60px_rgba(0,0,0,0.16)] dark:border-white/10 dark:bg-slate-900/90 sm:dark:bg-slate-900/80"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-5 py-3 dark:border-white/5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.5)] animate-pulse" />
                  <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                    {status === "available" && "发现新版本"}
                    {status === "downloading" && "正在下载更新"}
                    {status === "ready" && "更新已就绪"}
                    {status === "up-to-date" && "已是最新版本"}
                    {status === "error" && "更新失败"}
                    {(status === "idle" || status === "checking") && "检查更新"}
                  </h3>
                </div>
                {!downloadingLocked && (
                  <button
                    type="button"
                    onClick={dismiss}
                    aria-label="关闭"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/5"
                  >
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
                      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>

              <div
                className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
                style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
              >
                {status === "available" && update && (
                  <>
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="text-zinc-500 dark:text-zinc-400">当前版本</span>
                      <code className="font-mono text-zinc-800 dark:text-zinc-200">
                        {update.currentVersion}
                      </code>
                      <span className="text-zinc-400">→</span>
                      <code className="font-mono font-bold text-sky-600 dark:text-sky-300">
                        {update.version}
                      </code>
                      {update.date && (
                        <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500">
                          {formatDate(update.date)}
                        </span>
                      )}
                    </div>

                    {update.body && (
                      <div className="rounded-lg border border-black/5 bg-white/40 p-3 text-[13px] leading-relaxed text-zinc-700 dark:border-white/5 dark:bg-slate-800/50 dark:text-zinc-200">
                        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          更新说明
                        </h4>
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {update.body}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {status === "downloading" && (
                  <div className="flex flex-col gap-2">
                    <div className="text-sm text-zinc-600 dark:text-zinc-300">
                      {progress && progress.total > 0
                        ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                        : `已下载 ${formatBytes(progress?.downloaded ?? 0)}…`}
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-slate-700">
                      <motion.div
                        className="h-full bg-gradient-to-r from-sky-400 to-indigo-500"
                        initial={{ width: 0 }}
                        animate={{
                          width: percent !== null ? `${percent}%` : "30%",
                        }}
                        transition={
                          percent !== null
                            ? { duration: 0.2 }
                            : {
                                duration: 1.5,
                                repeat: Infinity,
                                repeatType: "reverse" as const,
                                ease: "easeInOut",
                              }
                        }
                      />
                    </div>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      下载中请勿关闭应用。安装将在下载完成后自动开始。
                    </p>
                  </div>
                )}

                {status === "ready" && (
                  <div className="flex flex-col gap-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
                    <p>新版本已下载并准备就绪，重启应用即可使用。</p>
                    <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
                      如有未保存的工作请先妥善处理（运行中的 Agent 任务会被中断）。
                    </p>
                  </div>
                )}

                {status === "up-to-date" && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    当前版本 <code className="font-mono">{__APP_VERSION__}</code> 已是最新。
                  </p>
                )}

                {status === "error" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm leading-relaxed text-rose-600 dark:text-rose-400">
                      {errorMessage || "未知错误"}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      可能是网络问题、签名验证失败或服务器无可用版本。
                    </p>
                  </div>
                )}

                {status === "checking" && (
                  <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                    <span className="h-3 w-3 animate-pulse rounded-full bg-sky-400" />
                    检查中…
                  </div>
                )}
              </div>

              <div className="flex shrink-0 justify-end gap-3 border-t border-black/5 px-5 py-3 dark:border-white/5">
                {status === "available" && (
                  <>
                    <button
                      type="button"
                      onClick={dismiss}
                      className="min-h-[40px] rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5"
                    >
                      稍后
                    </button>
                    <button
                      type="button"
                      onClick={() => void install()}
                      className="min-h-[40px] rounded-lg bg-sky-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-sky-400/25 transition-colors hover:bg-sky-600"
                    >
                      立即更新
                    </button>
                  </>
                )}

                {status === "downloading" && (
                  <button
                    type="button"
                    disabled
                    className="min-h-[40px] cursor-not-allowed rounded-lg bg-zinc-200 px-5 py-2 text-sm font-semibold text-zinc-400 dark:bg-slate-700 dark:text-zinc-500"
                  >
                    正在下载…
                  </button>
                )}

                {status === "ready" && (
                  <>
                    <button
                      type="button"
                      onClick={dismiss}
                      className="min-h-[40px] rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5"
                    >
                      稍后重启
                    </button>
                    <button
                      type="button"
                      onClick={() => void relaunch()}
                      className="min-h-[40px] rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-400/25 transition-colors hover:bg-emerald-600"
                    >
                      立即重启
                    </button>
                  </>
                )}

                {status === "up-to-date" && (
                  <button
                    type="button"
                    onClick={dismiss}
                    className="min-h-[40px] rounded-lg bg-zinc-100 px-5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-slate-700 dark:text-zinc-200 dark:hover:bg-slate-600"
                  >
                    好的
                  </button>
                )}

                {status === "error" && (
                  <>
                    <button
                      type="button"
                      onClick={dismiss}
                      className="min-h-[40px] rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5"
                    >
                      关闭
                    </button>
                    <button
                      type="button"
                      onClick={() => void check(false)}
                      className="min-h-[40px] rounded-lg bg-sky-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-sky-400/25 transition-colors hover:bg-sky-600"
                    >
                      重试
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
