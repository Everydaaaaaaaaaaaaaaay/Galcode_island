// 页内搜索（cmd/ctrl+f）：在当前 active tab 的 cliBlocks 范围内全文搜索，
// 命中**具体文字**用 <mark> 高亮（不是块级 ring）。
//
// 跟左栏的全局搜索不同 —— 这里只搜"我现在看着的项目"，浮在右上角不打断主区。
// 上下箭头在每个具体匹配实例（block + 字段 + 第 N 次出现）之间跳，
// 当前焦点那段用更深的金色高亮，其它命中段用浅金，当前那块同时 scrollIntoView。
//
// 触发：useInPageSearchHotkey 在 App 顶层 mount 一份全局 keydown 监听。

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveTab } from "../hooks/useActiveTab";
import { useUiStore, type ActiveMatch } from "../stores/useUiStore";
import { countOccurrences } from "./status-monitor/highlight";
import type { CliBlock } from "../types/blocks";

/// 一个块上要扫的字段顺序 —— 跟 BlockStream 子组件渲染时调 highlightText 用的
/// fieldKey 必须严格对齐，否则 occurrence 计数对不上。
const SEARCHABLE_FIELDS: { key: string; pick: (b: CliBlock) => string | null | undefined }[] = [
  { key: "content", pick: (b) => b.content },
  { key: "command", pick: (b) => b.command },
  { key: "output", pick: (b) => b.output },
  { key: "diff", pick: (b) => b.diff },
  { key: "path", pick: (b) => b.path },
  { key: "detail", pick: (b) => b.detail },
  { key: "message", pick: (b) => b.message },
  { key: "tool", pick: (b) => b.tool },
  { key: "title", pick: (b) => b.title },
];

export function InPageSearch(): JSX.Element | null {
  const open = useUiStore((s) => s.inPageSearchOpen);
  const close = useUiStore((s) => s.closeInPageSearch);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const setActiveMatch = useUiStore((s) => s.setActiveMatch);
  const tab = useActiveTab();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 打开时：清空旧 query + 聚焦
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const handle = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(handle);
    }
    return undefined;
  }, [open]);

  // 切 tab → 关搜（match 只跟当前 tab 内容有意义）
  useEffect(() => {
    if (open) close();
    // 仅依赖 tab.id；避免同 tab cliBlocks 增量变化时误关
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  // 把 query 同步进 store，让 BlockStream 子组件能读到做高亮
  useEffect(() => {
    setSearchQuery(open ? query : "");
  }, [open, query, setSearchQuery]);

  // 计算所有具体匹配实例：每个 block 的每个字段的每次出现都是一条
  const matches = useMemo(() => {
    const list: ActiveMatch[] = [];
    const q = query.trim();
    if (!q) return list;
    for (const block of tab.cliBlocks) {
      for (const { key, pick } of SEARCHABLE_FIELDS) {
        const text = pick(block);
        const n = countOccurrences(text, q);
        for (let i = 0; i < n; i += 1) {
          list.push({ blockId: block.id, field: key, occurrence: i });
        }
      }
    }
    return list;
  }, [query, tab.cliBlocks]);

  // query / matches 变 → 重置 activeIndex
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // 同步 active match 给 BlockStream（让它高亮 + scrollIntoView）
  useEffect(() => {
    if (!open) return;
    if (matches.length === 0) {
      setActiveMatch(null);
      return;
    }
    const idx = Math.max(0, Math.min(activeIndex, matches.length - 1));
    setActiveMatch(matches[idx]);
  }, [open, matches, activeIndex, setActiveMatch]);

  if (!open) return null;

  const total = matches.length;
  const handlePrev = (): void => {
    if (total === 0) return;
    setActiveIndex((i) => (i - 1 + total) % total);
  };
  const handleNext = (): void => {
    if (total === 0) return;
    setActiveIndex((i) => (i + 1) % total);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) handlePrev();
      else handleNext();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="in-page-search"
        initial={{ opacity: 0, y: -8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.96 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="absolute right-4 top-3 z-[150] flex items-center gap-1 rounded-lg border border-white/60 bg-white/85 px-2 py-1.5 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-zinc-800/85"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="项目内查找…"
          className="w-44 bg-transparent px-1 text-xs text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
        <span
          className={`shrink-0 px-1 font-mono text-[10px] tabular-nums ${
            query.trim() && total === 0
              ? "text-rose-500 dark:text-rose-400"
              : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {query.trim() === "" ? "" : total === 0 ? "无匹配" : `${activeIndex + 1} / ${total}`}
        </span>
        <button
          type="button"
          onClick={handlePrev}
          disabled={total === 0}
          aria-label="上一个匹配"
          title="上一个 (Shift+Enter)"
          className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3 w-3">
            <path d="M3 7.5L6 4.5L9 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={total === 0}
          aria-label="下一个匹配"
          title="下一个 (Enter)"
          className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3 w-3">
            <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="关闭搜索"
          title="关闭 (Esc)"
          className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-zinc-200"
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-2.5 w-2.5">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
          </svg>
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
