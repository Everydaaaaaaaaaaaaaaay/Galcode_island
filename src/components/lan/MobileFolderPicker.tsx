// 移动端 / 浏览器模式下的目录选择 modal。
//
// 浏览器模式没有原生 file dialog，bridge.pickFolder 默认 fallback 到 window.prompt
// 让用户手输绝对路径——体验差。这个 modal 替代 prompt：
//   - 后端 list_directory(path) 返回 path 下的子目录（跳过 . 开头）+ 父目录
//   - 进入时若没指定 initialPath 则从家目录开始
//   - 面包屑 + 子目录列表 + "上一级" + "选择当前目录" 按钮
//   - 移动端 sheet 风格全屏（safe-area 已处理）

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "../../lib/bridge";
import { useFolderPickerStore } from "../../stores/useFolderPickerStore";

interface DirectoryEntry {
  name: string;
  path: string;
}
interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
}

function splitBreadcrumbs(path: string): { label: string; path: string }[] {
  const isWindows = /^[A-Za-z]:[\\/]/.test(path);
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  if (isWindows) {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    const out: { label: string; path: string }[] = [];
    let acc = parts[0] + sep; // "C:\"
    out.push({ label: parts[0], path: acc });
    for (let i = 1; i < parts.length; i++) {
      acc += parts[i] + sep;
      out.push({ label: parts[i], path: acc.slice(0, -1) });
    }
    return out;
  }
  // POSIX
  const parts = path.split("/").filter(Boolean);
  const out: { label: string; path: string }[] = [{ label: "/", path: "/" }];
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    out.push({ label: p, path: acc });
  }
  return out;
}

export function MobileFolderPicker(): JSX.Element {
  const open = useFolderPickerStore((s) => s.open);
  const initialPath = useFolderPickerStore((s) => s.initialPath);
  const resolve = useFolderPickerStore((s) => s.resolve);

  const [listing, setListing] = React.useState<DirectoryListing | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (path: string | null): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<DirectoryListing>("list_directory", {
        path: path ?? undefined,
      });
      setListing(data);
    } catch (e) {
      setError(String(e));
      setListing(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 打开时载入初始目录
  React.useEffect(() => {
    if (open) {
      void load(initialPath ?? null);
    } else {
      // 关闭时清状态，下次打开重置
      setListing(null);
      setError(null);
    }
  }, [open, initialPath, load]);

  const breadcrumbs = listing ? splitBreadcrumbs(listing.path) : [];

  return (
    <AnimatePresence>
      {open && (
        <React.Fragment>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[300] bg-black/30 backdrop-blur-sm"
            onClick={() => resolve(null)}
          />

          <div className="fixed inset-0 z-[310] flex items-end justify-center pointer-events-none sm:items-center">
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="pointer-events-auto flex h-[88dvh] w-full flex-col rounded-t-2xl border border-white/60 bg-white/95 shadow-[0_-10px_40px_rgba(0,0,0,0.16)] backdrop-blur-2xl sm:h-[70dvh] sm:max-h-[640px] sm:w-[92%] sm:max-w-md sm:rounded-2xl sm:bg-white/85 dark:border-white/10 dark:bg-slate-900/95 sm:dark:bg-slate-900/85"
            >
              {/* 顶部标题 + 关闭 */}
              <div className="flex items-center justify-between border-b border-black/5 px-5 py-3 dark:border-white/5">
                <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                  选择项目目录
                </h3>
                <button
                  type="button"
                  onClick={() => resolve(null)}
                  aria-label="关闭"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/5"
                >
                  <svg
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* 面包屑 */}
              <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-black/5 px-4 py-2 text-[12px] dark:border-white/5">
                {breadcrumbs.length === 0 && (
                  <span className="text-zinc-400">{loading ? "加载中…" : "—"}</span>
                )}
                {breadcrumbs.map((seg, i) => (
                  <React.Fragment key={seg.path}>
                    {i > 0 && (
                      <span className="text-zinc-300 dark:text-zinc-600">/</span>
                    )}
                    <button
                      type="button"
                      onClick={() => void load(seg.path)}
                      className={`shrink-0 rounded px-1.5 py-0.5 transition-colors ${
                        i === breadcrumbs.length - 1
                          ? "bg-sky-400/15 font-medium text-sky-700 dark:bg-sky-400/20 dark:text-sky-300"
                          : "text-zinc-500 hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/5"
                      }`}
                    >
                      {seg.label}
                    </button>
                  </React.Fragment>
                ))}
              </div>

              {/* 列表 */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
                {error && (
                  <p className="mx-2 my-2 rounded-lg border border-rose-300/40 bg-rose-50/60 px-3 py-2 text-[13px] leading-relaxed text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300">
                    {error}
                  </p>
                )}

                {listing?.parent && (
                  <button
                    type="button"
                    onClick={() => void load(listing.parent)}
                    className="flex w-full min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-zinc-600 transition-colors hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5"
                  >
                    <span className="text-base">↑</span>
                    <span>上一级</span>
                  </button>
                )}

                {!loading && !error && listing && listing.entries.length === 0 && (
                  <p className="mx-2 my-3 text-center text-[13px] text-zinc-400 dark:text-zinc-500">
                    （空目录）
                  </p>
                )}

                {listing?.entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => void load(entry.path)}
                    className="flex w-full min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-zinc-700 transition-colors hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/5"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      className="h-4 w-4 shrink-0 text-amber-500"
                    >
                      <path d="M2 4h6l1 1.5h5v6.5a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  </button>
                ))}
              </div>

              {/* 底部操作 */}
              <div
                className="flex shrink-0 items-center justify-between gap-3 border-t border-black/5 px-5 py-3 dark:border-white/5"
                style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
              >
                <span
                  className="min-w-0 flex-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400"
                  title={listing?.path}
                >
                  {listing?.path ?? ""}
                </span>
                <button
                  type="button"
                  onClick={() => resolve(null)}
                  className="min-h-[40px] rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => listing && resolve(listing.path)}
                  disabled={!listing}
                  className="min-h-[40px] rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-sky-400/25 transition-all hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  选择当前
                </button>
              </div>
            </motion.div>
          </div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
}
