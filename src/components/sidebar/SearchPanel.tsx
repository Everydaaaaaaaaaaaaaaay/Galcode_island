// 左栏中部的"搜索"视图：跨项目 / 历史 / 流式块全文搜索。
//
// 搜索范围：
//   - 项目 (active tabs): title / lastUserPrompt / task / projectPath / summary
//   - 历史 (archived sessions): summary / projectPath / summaryTranslation / emotionText
//   - 块 (cliBlocks of all tabs): content / output / message / command / path / detail
//
// 交互：
//   - 输入框 debounce 150ms 后过滤
//   - 项目点击 → setActiveTab 切过去
//   - 历史点击 → restoreFromHistory 复活成新 tab + 切到 projects 视图
//   - 块点击 → 切到所属 tab + setDetailBlock 让右栏展开完整详情

import { useEffect, useMemo, useState } from "react";
import { useTabsStore, type TabState } from "../../stores/useTabsStore";
import { useUiStore } from "../../stores/useUiStore";
import { useAppStore } from "../../stores/useAppStore";
import type { CliBlock } from "../../types/blocks";

const PER_GROUP_LIMIT = 12;

function basename(p: string | null): string {
  if (!p) return "未选择目录";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/// 抽出一段含匹配位置的上下文片段（前后各 30 字符），让用户看到命中处。
function snippet(text: string | null | undefined, query: string): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return text.slice(0, 80);
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + q.length + 30);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

interface BlockHit {
  block: CliBlock;
  tabId: string;
  tabTitle: string;
  matchedField: string;
  preview: string;
}

function searchBlocksOfTab(tab: TabState, q: string): BlockHit[] {
  const hits: BlockHit[] = [];
  const lowerQ = q.toLowerCase();
  for (const block of tab.cliBlocks) {
    const tryMatch = (field: string, value: string | undefined): boolean => {
      if (!value) return false;
      if (!value.toLowerCase().includes(lowerQ)) return false;
      hits.push({
        block,
        tabId: tab.id,
        tabTitle:
          tab.lastUserPrompt?.slice(0, 24) ||
          tab.title ||
          basename(tab.projectPath),
        matchedField: field,
        preview: snippet(value, q),
      });
      return true;
    };
    // 字段优先级：内容 > 输出 > 命令 > 路径 / 详情 / 消息
    if (tryMatch("content", block.content)) continue;
    if (tryMatch("output", block.output)) continue;
    if (tryMatch("command", block.command)) continue;
    if (tryMatch("diff", block.diff)) continue;
    if (tryMatch("path", block.path)) continue;
    if (tryMatch("detail", block.detail)) continue;
    if (tryMatch("message", block.message)) continue;
  }
  return hits;
}

interface SearchResults {
  projects: TabState[];
  history: ReturnType<typeof useTabsStore.getState>["history"];
  blocks: BlockHit[];
}

function runSearch(q: string): SearchResults {
  const trimmed = q.trim().toLowerCase();
  if (!trimmed) return { projects: [], history: [], blocks: [] };
  const { tabs, order, history } = useTabsStore.getState();

  const projects: TabState[] = [];
  for (const id of order) {
    const tab = tabs[id];
    if (!tab) continue;
    const hay = [
      tab.title,
      tab.task,
      tab.lastUserPrompt,
      tab.projectPath,
      tab.summaryTranslation,
      tab.emotionText,
      tab.resultZh,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    if (hay.includes(trimmed)) projects.push(tab);
    if (projects.length >= PER_GROUP_LIMIT) break;
  }

  const historyHits = history
    .filter((h) => {
      const hay = [
        h.summary,
        h.projectPath,
        h.summaryTranslation,
        h.emotionText,
        h.resultZh,
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return hay.includes(trimmed);
    })
    .slice(0, PER_GROUP_LIMIT);

  const blocks: BlockHit[] = [];
  for (const id of order) {
    const tab = tabs[id];
    if (!tab) continue;
    blocks.push(...searchBlocksOfTab(tab, trimmed));
    if (blocks.length >= PER_GROUP_LIMIT * 2) break;
  }

  return { projects, history: historyHits, blocks: blocks.slice(0, PER_GROUP_LIMIT) };
}

export function SearchPanel(): JSX.Element {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // 每次输入变化 150ms 后跑搜索（避免每个键都过一遍 cliBlocks）
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(handle);
  }, [query]);

  // store 内容变化（新 tab / 新 block）时也重新跑一次
  const tabsVersion = useTabsStore((s) => s.order.length + s.history.length);

  const results = useMemo(
    () => runSearch(debouncedQuery),
    // tabsVersion 进入 deps 让 store 增减时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedQuery, tabsVersion],
  );

  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const restoreFromHistory = useTabsStore((s) => s.restoreFromHistory);
  const setDetailBlock = useUiStore((s) => s.setDetailBlock);
  const setLeftSidebarView = useUiStore((s) => s.setLeftSidebarView);
  const setIsStarted = useAppStore((s) => s.setIsStarted);

  const handleProjectClick = (tabId: string): void => {
    setActiveTab(tabId);
  };

  const handleHistoryClick = (id: string): void => {
    const newId = restoreFromHistory(id);
    if (newId) {
      setActiveTab(newId);
      setIsStarted(true);
      setLeftSidebarView("projects");
    }
  };

  const handleBlockClick = (hit: BlockHit): void => {
    setActiveTab(hit.tabId);
    setDetailBlock(hit.block);
  };

  const isEmpty =
    debouncedQuery.trim().length > 0 &&
    results.projects.length === 0 &&
    results.history.length === 0 &&
    results.blocks.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-black/5 px-2 py-2 dark:border-white/5">
        <div className="relative">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L13.5 13.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索项目 / 历史 / 输出内容…"
            autoFocus
            className="w-full rounded-md border border-black/5 bg-white/45 py-1.5 pl-7 pr-2 text-[12px] text-zinc-700 outline-none transition-all placeholder:text-zinc-400 focus:border-sky-400/50 focus:bg-white/80 focus:ring-2 focus:ring-sky-400/15 dark:border-white/5 dark:bg-zinc-800/45 dark:text-zinc-200 dark:placeholder:text-zinc-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="清空搜索"
              className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-zinc-200"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-2.5 w-2.5">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-2">
        {!debouncedQuery.trim() && (
          <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
            输入关键词开始搜索
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
            没有匹配的内容
          </div>
        )}

        {results.projects.length > 0 && (
          <ResultGroup label="项目" count={results.projects.length}>
            {results.projects.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleProjectClick(tab.id)}
                className="flex w-full flex-col gap-0.5 rounded-md border border-white/40 bg-white/40 px-2 py-1.5 text-left transition-all hover:bg-white/70 dark:border-white/10 dark:bg-zinc-800/40 dark:hover:bg-zinc-800/65"
              >
                <div className="truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                  {tab.lastUserPrompt || tab.task || tab.title || "新会话"}
                </div>
                <div className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                  {basename(tab.projectPath)} · {tab.agent}
                </div>
              </button>
            ))}
          </ResultGroup>
        )}

        {results.history.length > 0 && (
          <ResultGroup label="历史" count={results.history.length}>
            {results.history.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => handleHistoryClick(h.id)}
                className="flex w-full flex-col gap-0.5 rounded-md border border-white/40 bg-white/40 px-2 py-1.5 text-left transition-all hover:bg-white/70 dark:border-white/10 dark:bg-zinc-800/40 dark:hover:bg-zinc-800/65"
              >
                <div className="truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                  {h.summary}
                </div>
                <div className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                  {basename(h.projectPath)} · {h.agent}
                </div>
              </button>
            ))}
          </ResultGroup>
        )}

        {results.blocks.length > 0 && (
          <ResultGroup label="过去输出" count={results.blocks.length}>
            {results.blocks.map((hit) => (
              <button
                key={`${hit.tabId}-${hit.block.id}-${hit.matchedField}`}
                type="button"
                onClick={() => handleBlockClick(hit)}
                className="flex w-full flex-col gap-0.5 rounded-md border border-white/40 bg-white/40 px-2 py-1.5 text-left transition-all hover:bg-white/70 dark:border-white/10 dark:bg-zinc-800/40 dark:hover:bg-zinc-800/65"
              >
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span className="rounded bg-zinc-200/60 px-1 font-mono dark:bg-zinc-700/60">
                    {hit.block.type}
                  </span>
                  <span className="truncate">{hit.tabTitle}</span>
                </div>
                <div className="line-clamp-2 break-all text-[11px] text-zinc-700 dark:text-zinc-200">
                  {hit.preview}
                </div>
              </button>
            ))}
          </ResultGroup>
        )}
      </div>
    </div>
  );
}

function ResultGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
        {label} ({count})
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
