// 全局 UI 状态：跟"哪个 tab 哪份会话"无关的瞬时 UI 控制（侧栏开合、
// 当前查看的详情块等）。不持久化（重启后右栏默认收起）。

import { create } from "zustand";
import type { CliBlock } from "../types/blocks";

interface UiState {
  /// 右栏当前打开的"块详情"。null 表示右栏收起。
  /// 不存 ID + lookup，直接存整个 block —— 用户切 tab 后 detail 不应该消失，
  /// 但块本身仍持有；前端只在用户主动关闭时清掉。
  detailBlock: CliBlock | null;
  setDetailBlock: (block: CliBlock | null) => void;
  closeDetail: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  detailBlock: null,
  setDetailBlock: (block) => set({ detailBlock: block }),
  closeDetail: () => set({ detailBlock: null }),
}));
