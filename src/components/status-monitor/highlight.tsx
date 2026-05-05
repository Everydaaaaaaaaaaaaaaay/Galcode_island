// 文本搜索高亮工具：
//
// `highlightText(text, query, fieldKey, activeMatch)` 把 `text` 切成片段：
//   - 命中段包 <mark>，普通命中浅黄；当前焦点（cmd+f 上下箭头选中那个）深黄；
//   - 非命中段保持原样字符串；
//   - 没 query / text 空 → 直接返回原值，不破坏调用方布局。
//
// 调用方需要给"字段身份"传 fieldKey（"content" / "output" / "command" / ...）；
// 当 activeMatch.blockId === 当前块 + activeMatch.field === fieldKey + occurrence
// 计数命中时，那段就是 active mark。

import type { ReactNode } from "react";
import type { ActiveMatch } from "../../stores/useUiStore";

const MARK_BASE = "rounded-sm";
const MARK_NORMAL = "bg-amber-300/45 text-inherit";
const MARK_ACTIVE = "bg-amber-400/85 text-zinc-900 dark:text-zinc-900 ring-1 ring-amber-500/70";

export function highlightText(
  text: string | null | undefined,
  query: string,
  blockId: string,
  field: string,
  activeMatch: ActiveMatch | null,
  occurrenceOffset = 0,
): ReactNode {
  if (!text) return text ?? "";
  const q = query.trim();
  if (!q) return text;

  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const out: ReactNode[] = [];
  let cursor = 0;
  let occ = occurrenceOffset;
  let pos = lower.indexOf(ql, cursor);

  while (pos >= 0) {
    if (pos > cursor) out.push(text.slice(cursor, pos));
    const isActive =
      activeMatch !== null &&
      activeMatch.blockId === blockId &&
      activeMatch.field === field &&
      activeMatch.occurrence === occ;
    out.push(
      <mark
        key={`m-${field}-${occ}-${pos}`}
        data-search-active={isActive ? "true" : undefined}
        className={`${MARK_BASE} ${isActive ? MARK_ACTIVE : MARK_NORMAL}`}
      >
        {text.slice(pos, pos + q.length)}
      </mark>,
    );
    cursor = pos + q.length;
    occ += 1;
    pos = lower.indexOf(ql, cursor);
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  if (out.length === 0) return text;
  return <>{out}</>;
}

/// 统计某字段含 query 的匹配次数（不渲染，仅计数）；用于 InPageSearch 列举所有
/// 匹配位置好让上下箭头逐个跳。
export function countOccurrences(text: string | null | undefined, query: string): number {
  if (!text) return 0;
  const q = query.trim();
  if (!q) return 0;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let cursor = 0;
  let count = 0;
  let pos = lower.indexOf(ql, cursor);
  while (pos >= 0) {
    count += 1;
    cursor = pos + q.length;
    pos = lower.indexOf(ql, cursor);
  }
  return count;
}
