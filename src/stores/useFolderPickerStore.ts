// 移动端 / 浏览器模式下的目录选择 modal 状态。
//
// pickFolder() 在浏览器模式下调 show()，得到一个 Promise<string | null>；
// modal 让用户从家目录开始浏览到目标目录，点"选择当前目录"或"取消"时
// resolve / reject 这个 Promise。设计成全局 store 是为了：
//   - bridge.ts 的 pickFolder 是个普通 async 函数，没法直接调 React 组件
//   - 通过 store 把"展示意图"和"用户选择结果"用 Promise 串起来
//   - 任意位置（设置面板 / WelcomeView / ProjectTree）调 pickFolder 都能弹同一个 modal

import { create } from "zustand";

interface FolderPickerState {
  open: boolean;
  /// 弹出时的初始路径，None 时后端 fallback 到家目录
  initialPath: string | null;
  /// 当前 Promise 的 resolver。show() 时设置，resolve() 时清掉。
  resolver: ((path: string | null) => void) | null;

  /// 弹出 modal，返回 Promise，用户选定 / 取消时 resolve。
  /// 同时只允许一个 picker 打开 —— 重复 show 会让上一个 resolve(null)。
  show: (initialPath?: string | null) => Promise<string | null>;
  /// 用户在 modal 里点选 / 取消时调用。null 表示取消。
  resolve: (path: string | null) => void;
}

export const useFolderPickerStore = create<FolderPickerState>((set, get) => ({
  open: false,
  initialPath: null,
  resolver: null,

  show: (initialPath) =>
    new Promise<string | null>((resolve) => {
      // 上一个 picker 还开着 → 替它 resolve(null) 再开新的
      const prev = get().resolver;
      if (prev) prev(null);
      set({ open: true, initialPath: initialPath ?? null, resolver: resolve });
    }),

  resolve: (path) => {
    const r = get().resolver;
    set({ open: false, initialPath: null, resolver: null });
    r?.(path);
  },
}));
