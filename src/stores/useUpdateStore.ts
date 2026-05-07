// 自动更新的 UI 状态机。
//
// 状态流转：
//   idle ──checkForUpdate()─→ checking
//                                │
//                                ├─ 有新版 → available ──install()─→ downloading ──→ ready
//                                │                                                       │
//                                │                                                       └→ relaunch()
//                                ├─ 已是最新 → idle (附带 lastCheckedAt)
//                                └─ 错误     → error (附带 errorMessage)
//
// available → downloading → ready 三个阶段对应 UpdateModal 的三个视图。
// dismiss() 关闭 modal 但不重置 update 数据（用户下次打开还能看到）。

import { create } from "zustand";
import {
  checkForUpdate,
  downloadAndInstall,
  relaunchApp,
  type UpdateInfo,
  type DownloadProgress,
} from "../lib/updater";

export type UpdateStatus =
  | "idle"          // 没在做啥
  | "checking"      // 正在 check
  | "available"     // 检测到新版，等用户决定下不下
  | "downloading"   // 下载安装中
  | "ready"         // 已安装完，等 relaunch
  | "up-to-date"    // 检查后发现已是最新
  | "error";        // 检查 / 下载 / 安装失败

interface UpdateState {
  status: UpdateStatus;
  update: UpdateInfo | null;
  progress: DownloadProgress | null;
  errorMessage: string | null;
  /// modal 是否显示。check() 自动检查发现新版本时打开；用户点"应用更新"也打开。
  modalOpen: boolean;
  /// 上次 check 完成的 Unix ms 时间戳；UI 显示"上次检查于 X 分钟前"
  lastCheckedAt: number | null;

  /// 检查更新。autoTriggered=true 表示后台自动检查（找到新版才弹 modal；
  /// 没新版时静默不弹）。autoTriggered=false 表示用户手动点检查（无论结果都弹 modal）。
  check: (autoTriggered?: boolean) => Promise<void>;
  /// 开始下载并安装当前 cached 的 update
  install: () => Promise<void>;
  /// 安装完后重启应用
  relaunch: () => Promise<void>;
  /// 关闭 modal（保留 status，下次还能从设置面板看到）
  dismiss: () => void;
  /// 强制重置（debug 用）
  reset: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  update: null,
  progress: null,
  errorMessage: null,
  modalOpen: false,
  lastCheckedAt: null,

  check: async (autoTriggered = false) => {
    if (get().status === "checking" || get().status === "downloading") return;
    set({ status: "checking", errorMessage: null });
    try {
      const info = await checkForUpdate();
      const now = Date.now();
      if (info) {
        set({
          status: "available",
          update: info,
          lastCheckedAt: now,
          modalOpen: true, // 找到新版无论是不是后台触发都弹
        });
      } else {
        set({
          status: "up-to-date",
          update: null,
          lastCheckedAt: now,
          // 后台触发不弹（避免静默时 UI 抖动）；用户手动点了才弹"已是最新"
          modalOpen: !autoTriggered,
        });
      }
    } catch (err) {
      set({
        status: "error",
        errorMessage: String(err),
        modalOpen: !autoTriggered,
      });
    }
  },

  install: async () => {
    const u = get().update;
    if (!u) return;
    set({ status: "downloading", progress: { downloaded: 0, total: 0 } });
    try {
      await downloadAndInstall((p) => set({ progress: p }));
      set({ status: "ready" });
    } catch (err) {
      set({ status: "error", errorMessage: String(err) });
    }
  },

  relaunch: async () => {
    try {
      await relaunchApp();
    } catch (err) {
      set({ status: "error", errorMessage: String(err) });
    }
  },

  dismiss: () => set({ modalOpen: false }),

  reset: () =>
    set({
      status: "idle",
      update: null,
      progress: null,
      errorMessage: null,
      modalOpen: false,
    }),
}));
