// 多 tab store —— 每个 tab 一份独立的会话状态（项目路径 / 输入框 / agent 状态 /
// 流式 blocks / 总结结果），互不干扰。
//
// 设计参考 designcode 的 `composables/useTabs.js`：
//   - tabs 用 Record<id, slice>（不是 Map）方便 zustand selector 浅比较
//   - order 单独存一个数组，TabBar 按 order 渲染
//   - activeTabId 是当前显示哪个 tab；切 tab 用 setActiveTab(id)
//   - createTab 返回新 id，调用方拿到后立即 setActiveTab
//
// run_id 跟 tab_id 是同一个标识：前端创建 tab 时生成 UUID，传给后端
// `start_agent({ runId })`，后端所有事件 payload 也带 runId，前端按它路由
// 到对应 tab slice。

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  AgentStatus,
  AgentType,
  LastStage,
  UiState,
} from "../types/agent";
import type { CliBlock } from "../types/blocks";

const MAX_BLOCKS = 200;
const TRIM_TARGET = 180;

/// 单个 tab 的完整状态。每个字段都是会话级 —— tab 之间完全隔离。
export interface TabState {
  id: string;
  /// 显示在 TabBar 的标题；用户可重命名；默认从 task / projectPath basename 推
  title: string;
  /// 该 tab 下次启动时用哪个 backend；可单独切换不影响其他 tab
  agent: AgentType;
  /// 该 tab 的工作目录；为 null 表示还没选
  projectPath: string | null;
  /// 输入框文本
  task: string;
  /// 后端最近 emit 的 agentStatus（idle/running/thinking/...）
  agentStatus: AgentStatus;
  /// UI 阶段（idle/running/done/error/suggesting）
  uiState: UiState;
  /// 桌宠/总结 mode（idle/working/thinking/complete/suggestion/error）
  mode: string;
  /// RunningBubble 显示的当前提示（来自工具描述 / 进度文案）
  bubble: string;
  /// 进度条百分比
  percent: number;
  /// 后端 session_id（claude/codex/opencode 各自的会话标识，用于续接）
  sessionId: string | null;
  /// 完成后的中文翻译输出
  resultZh: string;
  /// 凉宫春日总结
  summaryTranslation: string;
  /// 凉宫春日的语气短句
  emotionText: string;
  /// 完成后给的下一步选项按钮
  suggestionOptions: string[];
  /// 影响 PetCharacter GIF 选择的最终阶段
  lastStage: LastStage;
  /// 流式 blocks（BlockStream 渲染源）
  cliBlocks: CliBlock[];
  /// 非活动 tab 完成后置 true，TabBar 显示小红点；切到该 tab 自动清掉
  hasUnread: boolean;
  /// agent turn 完成、finalize（翻译+总结）跑到一半时退出 app 用：后端在
  /// finalize 之前 emit `agent://result-raw`，前端写入这两个字段并持久化；
  /// 重启时 useTabsReattach 检测到非空就调 finalize_pending 自动接续，
  /// session-complete 到来时清空。null 表示当前没有 pending finalize。
  pendingResultRaw: string | null;
  pendingUserZh: string | null;
  /// 创建时间戳，用来排序 / 关闭时回退到上一个
  createdAt: number;
}

interface TabsStoreState {
  tabs: Record<string, TabState>;
  /// TabBar 显示顺序；新建的追加到末尾；关闭时从这里 splice
  order: string[];
  activeTabId: string | null;

  /// 创建一个新 tab。init 可指定初始字段（agent / projectPath / 标题等），
  /// 返回新 tab 的 id；不会自动切到新 tab，调用方如需切换显式调 setActiveTab。
  ///
  /// `id` 可选：默认生成 UUID；reattach 场景下可指定后端 runId 当 id，
  /// 让前端 tab.id ↔ 后端 runId 绑定（已存在的 id 会被忽略，返回原 id）。
  createTab: (init?: Partial<Omit<TabState, "createdAt">>) => string;
  /// 关闭 tab；如果是当前 active 会自动切到相邻 tab；最后一个 tab 关闭后
  /// activeTabId 变成 null（调用方应处理这种状态，比如回 WelcomeView）。
  removeTab: (id: string) => void;
  /// 切换当前活动 tab；切到时自动清 hasUnread 标记。
  setActiveTab: (id: string) => void;
  /// 局部更新指定 tab 字段。不存在的 tab 直接忽略（不 throw，避免 IPC 事件
  /// 撞到刚关闭的 tab 时把 store 弄坏）。
  updateTab: (id: string, patch: Partial<TabState>) => void;
  /// 重置某个 tab 的会话级字段（保留 projectPath / agent / title / id），
  /// 用于"清屏"或开始新一轮 turn 前的清理。
  resetTabSession: (id: string) => void;

  // CliBlock 操作 —— 跟旧 useAppStore 的语义一致，但每次都按 tab 路由
  appendCliBlock: (id: string, block: CliBlock) => void;
  upsertCliBlock: (id: string, block: CliBlock) => void;
  clearCliBlocks: (id: string) => void;

  /// 多 tab 路由辅助：根据后端事件 payload 的 runId 找到 tab id；
  /// runId 直接对应 tab.id，所以这里其实就是看 tabs[runId] 是否存在。
  hasTab: (runId: string) => boolean;
  /// 通过 sessionId 反查 runId（IPC 事件早期还没回填 runId 时用）。
  findTabBySessionId: (sessionId: string) => string | null;
}

function generateTabId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // fallback：足够强的伪随机；只在 SSR / 老环境 fallback
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeDefaultTab(init?: Partial<TabState>): TabState {
  return {
    id: "",
    title: init?.title ?? "新会话",
    agent: init?.agent ?? "claude-code",
    projectPath: init?.projectPath ?? null,
    task: init?.task ?? "",
    agentStatus: init?.agentStatus ?? "idle",
    uiState: init?.uiState ?? "idle",
    mode: init?.mode ?? "idle",
    bubble: init?.bubble ?? "",
    percent: init?.percent ?? 0,
    sessionId: init?.sessionId ?? null,
    resultZh: init?.resultZh ?? "",
    summaryTranslation: init?.summaryTranslation ?? "",
    emotionText: init?.emotionText ?? "",
    suggestionOptions: init?.suggestionOptions ?? [],
    lastStage: init?.lastStage ?? "default",
    pendingResultRaw: init?.pendingResultRaw ?? null,
    pendingUserZh: init?.pendingUserZh ?? null,
    cliBlocks: init?.cliBlocks ?? [],
    hasUnread: init?.hasUnread ?? false,
    createdAt: 0,
  };
}

/// 持久化时单 tab 最多保留多少个 cliBlocks。
/// localStorage 单 origin 配额一般 5–10MB，几个 tab 各几百个 block 容易撞上限；
/// 限制到 120 块就够回看上次工作过程的关键节点（也是 store 内存里 MAX 的 60%）。
/// 启动后用户可以正常累积新 block，超过 200 时仍按内存里的 trim 策略截断。
const PERSIST_BLOCKS_PER_TAB = 120;

/// `mode` 字段是混合语义：既包含**结果态**（complete / suggestion / error / idle），
/// 也包含**过程态**（thinking / working）。持久化时过程态没有意义（进程已死），
/// 但要保留结果态让 ResultCard 重启后能显示上次完成的总结。
const MODE_RESULT_STATES = new Set(["complete", "suggestion", "error", "idle"]);

/// 准备 localStorage 快照：保留过去工作进度（cliBlocks / task / 上次结果），
/// 只重置真正"运行时一次性"的字段。
///   - percent / bubble：进度文字，进程已死无意义
///   - agentStatus / uiState：运行状态由 reattach + 实际 list_sessions 决定
///   - mode：过程态（thinking/working）一律改 idle，否则重启后 RunningBubble 会
///     误判"还在跑"显示"AGENT 正在全力执行…"；结果态（complete/suggestion/error）
///     保留让 ResultCard 能续显示上次总结
/// 保留：
///   - cliBlocks：BlockStream 重启后能继续显示上次工作的全过程（裁剪到最近 N 块）
///   - task：输入框半成品，让用户切回来继续打
///   - hasUnread：跨 tab 红点状态保留，用户能记住哪个 tab 还没看
///   - resultZh / summary / emotion / suggestionOptions：右下结果卡内容
///   - lastStage：影响 PetCharacter 立绘
function sanitizeTabForPersist(tab: TabState): TabState {
  const trimmedBlocks =
    tab.cliBlocks.length > PERSIST_BLOCKS_PER_TAB
      ? tab.cliBlocks.slice(-PERSIST_BLOCKS_PER_TAB)
      : tab.cliBlocks;
  // 过程态的 mode 改 idle；结果态保留
  const sanitizedMode = MODE_RESULT_STATES.has(tab.mode) ? tab.mode : "idle";
  // lastStage 同理：thinking / working / init 都是过程态，重置为 default 让
  // PetCharacter 不卡在"思考"立绘
  const lastStage = tab.lastStage === "thinking" || tab.lastStage === "working" || tab.lastStage === "init"
    ? "default"
    : tab.lastStage;
  return {
    ...tab,
    cliBlocks: trimmedBlocks,
    percent: 0,
    bubble: "",
    agentStatus: "idle",
    uiState: "idle",
    mode: sanitizedMode,
    lastStage,
  };
}

export const useTabsStore = create<TabsStoreState>()(
  persist<TabsStoreState>(
    (set, get) => ({
  tabs: {},
  order: [],
  activeTabId: null,

  createTab: (init) => {
    const requestedId = init?.id;
    if (requestedId && get().tabs[requestedId]) {
      // 已存在则不重建，返回现有 id（reattach 路径幂等）
      return requestedId;
    }
    const id = requestedId ?? generateTabId();
    const tab: TabState = {
      ...makeDefaultTab(init),
      id,
      createdAt: Date.now(),
    };
    set((state) => ({
      tabs: { ...state.tabs, [id]: tab },
      order: [...state.order, id],
    }));
    return id;
  },

  removeTab: (id) => {
    set((state) => {
      if (!state.tabs[id]) return state;
      const nextTabs = { ...state.tabs };
      delete nextTabs[id];
      const nextOrder = state.order.filter((tid) => tid !== id);
      let nextActive = state.activeTabId;
      if (state.activeTabId === id) {
        // 切到被关闭 tab 在 order 中的前一个；都没了就 null
        const idx = state.order.indexOf(id);
        nextActive = nextOrder[Math.max(0, idx - 1)] ?? nextOrder[0] ?? null;
      }
      return { tabs: nextTabs, order: nextOrder, activeTabId: nextActive };
    });
  },

  setActiveTab: (id) => {
    set((state) => {
      if (!state.tabs[id]) return state;
      const tab = state.tabs[id];
      // 切过来时自动清未读标记
      const nextTabs = tab.hasUnread
        ? { ...state.tabs, [id]: { ...tab, hasUnread: false } }
        : state.tabs;
      return { activeTabId: id, tabs: nextTabs };
    });
  },

  updateTab: (id, patch) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      return { tabs: { ...state.tabs, [id]: { ...tab, ...patch } } };
    });
  },

  resetTabSession: (id) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      return {
        tabs: {
          ...state.tabs,
          [id]: {
            ...tab,
            task: "",
            agentStatus: "idle",
            uiState: "idle",
            mode: "idle",
            bubble: "",
            percent: 0,
            sessionId: null,
            resultZh: "",
            summaryTranslation: "",
            emotionText: "",
            suggestionOptions: [],
            lastStage: "default",
            cliBlocks: [],
            hasUnread: false,
          },
        },
      };
    });
  },

  appendCliBlock: (id, block) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      const next = [...tab.cliBlocks, block];
      const trimmed = next.length > MAX_BLOCKS ? next.slice(-TRIM_TARGET) : next;
      return { tabs: { ...state.tabs, [id]: { ...tab, cliBlocks: trimmed } } };
    });
  },

  upsertCliBlock: (id, block) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      const idx = tab.cliBlocks.findIndex((b) => b.id === block.id);
      let next: CliBlock[];
      if (idx >= 0) {
        next = tab.cliBlocks.slice();
        next[idx] = { ...next[idx], ...block };
      } else {
        next = [...tab.cliBlocks, block];
      }
      const trimmed = next.length > MAX_BLOCKS ? next.slice(-TRIM_TARGET) : next;
      return { tabs: { ...state.tabs, [id]: { ...tab, cliBlocks: trimmed } } };
    });
  },

  clearCliBlocks: (id) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      return { tabs: { ...state.tabs, [id]: { ...tab, cliBlocks: [] } } };
    });
  },

  hasTab: (runId) => Boolean(get().tabs[runId]),

  findTabBySessionId: (sessionId) => {
    const { tabs } = get();
    for (const tab of Object.values(tabs)) {
      if (tab.sessionId === sessionId) return tab.id;
    }
    return null;
  },
    }),
    {
      name: "galcode_tabs",
      version: 1,
      // 自定义 storage：撞 localStorage 配额（QuotaExceededError）时不让
      // zustand 整个写失败 —— 改为逐 tab 把 cliBlocks 砍半重试，确保至少
      // tab 列表 / 上次结果能存进去。最差情况下完全丢 cliBlocks 也能继续工作。
      storage: createJSONStorage(() => ({
        getItem: (k) => localStorage.getItem(k),
        removeItem: (k) => localStorage.removeItem(k),
        setItem: (k, v) => {
          try {
            localStorage.setItem(k, v);
            return;
          } catch (err) {
            if (!isQuotaError(err)) throw err;
            console.warn("[tabs] localStorage 配额不足，砍半 cliBlocks 重试");
          }
          // 第一次失败：把每个 tab 的 cliBlocks 砍半再写
          try {
            const parsed = JSON.parse(v) as { state?: { tabs?: Record<string, TabState> } };
            if (parsed.state?.tabs) {
              for (const id of Object.keys(parsed.state.tabs)) {
                const blocks = parsed.state.tabs[id].cliBlocks ?? [];
                parsed.state.tabs[id].cliBlocks = blocks.slice(-Math.floor(blocks.length / 2));
              }
              localStorage.setItem(k, JSON.stringify(parsed));
              return;
            }
          } catch (e) {
            console.warn("[tabs] 砍半重试失败", e);
          }
          // 第二次失败：彻底丢掉 cliBlocks 兜底
          try {
            const parsed = JSON.parse(v) as { state?: { tabs?: Record<string, TabState> } };
            if (parsed.state?.tabs) {
              for (const id of Object.keys(parsed.state.tabs)) {
                parsed.state.tabs[id].cliBlocks = [];
              }
              localStorage.setItem(k, JSON.stringify(parsed));
            }
          } catch (e) {
            console.error("[tabs] 持久化彻底失败", e);
          }
        },
      })),
      partialize: (state) =>
        ({
          tabs: Object.fromEntries(
            Object.entries(state.tabs).map(([id, tab]) => [id, sanitizeTabForPersist(tab)]),
          ),
          order: state.order,
          activeTabId: state.activeTabId,
        }) as unknown as TabsStoreState,
      // 重启加载时再 sanitize 一次，防止旧版本残留运行时字段
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const id of Object.keys(state.tabs)) {
          state.tabs[id] = sanitizeTabForPersist(state.tabs[id]);
        }
      },
    },
  ),
);

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // 不同浏览器报错 name 不一样：QuotaExceededError / NS_ERROR_DOM_QUOTA_REACHED / ...
  return /quota|exceed/i.test(err.name) || /quota|exceed/i.test(err.message);
}
