// 三栏布局的右栏：默认收起；点击中栏的 command / diff / stderr 块时展开
// 显示完整详情。中栏 BlockStream 对这些块做缩略，详情留给这里。

import { AnimatePresence, motion } from "framer-motion";
import { useUiStore } from "../../stores/useUiStore";
import type { CliBlock } from "../../types/blocks";

const RIGHT_WIDTH = 380;

function CommandDetail({ block }: { block: CliBlock }): JSX.Element {
  const cmd = block.command?.trim() || "(command)";
  const output = block.output ?? "";
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-700/30 px-3 py-2 font-mono text-[12px] text-zinc-200">
        <span className="mr-2 text-emerald-300">$</span>
        {cmd}
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-300">
        {output || "(no output)"}
      </pre>
    </div>
  );
}

function DiffDetail({ block }: { block: CliBlock }): JSX.Element {
  const path = block.path?.trim() || "(unknown file)";
  const tool = block.tool?.trim() || "Edit";
  const lines = (block.diff ?? "").split("\n");
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-700/30 px-3 py-2 font-mono text-[12px] text-zinc-200">
        <span className="text-amber-300">{tool}</span>{" "}
        <span className="text-sky-300">{path}</span>
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
        {lines.map((line, i) => {
          let cls = "text-zinc-400";
          if (line.startsWith("+")) cls = "bg-emerald-500/10 text-emerald-300";
          else if (line.startsWith("-")) cls = "bg-rose-500/10 text-rose-300";
          else if (line.startsWith("@@")) cls = "text-amber-300";
          return (
            <div key={i} className={`px-3 ${cls}`}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function StderrDetail({ block }: { block: CliBlock }): JSX.Element {
  const msg = block.message ?? "";
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-700/30 px-3 py-2 font-mono text-[12px] text-rose-300">
        stderr · {block.backend ?? "unknown"}
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-300">
        {msg}
      </pre>
    </div>
  );
}

function DetailViewer({ block }: { block: CliBlock }): JSX.Element {
  switch (block.type) {
    case "command":
      return <CommandDetail block={block} />;
    case "diff":
      return <DiffDetail block={block} />;
    case "stderr":
      return <StderrDetail block={block} />;
    default:
      // fallback：直接 JSON 序列化展示
      return (
        <pre className="h-full overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[11px] text-zinc-300">
          {JSON.stringify(block, null, 2)}
        </pre>
      );
  }
}

export function SidebarRight(): JSX.Element {
  const detailBlock = useUiStore((s) => s.detailBlock);
  const closeDetail = useUiStore((s) => s.closeDetail);

  return (
    <AnimatePresence initial={false}>
      {detailBlock && (
        <motion.aside
          key="sidebar-right"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          // 移动端 fixed 全屏覆盖：h-[100dvh] 跟随可视区高度，避开浏览器底栏；
          // pt 让出 MobileTopBar + safe-top；pb 让出 home indicator。
          // 桌面端 lg+ relative 内嵌时这些响应式归零。
          className="flex flex-col overflow-hidden border-l border-black/5 bg-zinc-900/95 text-zinc-100
                     fixed top-0 left-0 right-0 z-40 h-[100dvh] w-full
                     pt-[calc(2.75rem_+_env(safe-area-inset-top))]
                     pb-[env(safe-area-inset-bottom)]
                     lg:relative lg:inset-auto lg:z-auto lg:h-full lg:shrink-0 lg:pt-0 lg:pb-0
                     dark:border-white/5"
          style={{
            // 桌面端固定 380px 宽；移动端走 fixed 全屏，不需要 width style
            ...(typeof window !== "undefined" && window.innerWidth >= 1024
              ? { width: RIGHT_WIDTH }
              : {}),
          }}
        >
          <div className="flex items-center justify-between border-b border-zinc-700/40 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-zinc-400">
            <span>{detailBlock.type} 详情</span>
            <button
              type="button"
              onClick={closeDetail}
              aria-label="关闭详情面板"
              className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <DetailViewer block={detailBlock} />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
