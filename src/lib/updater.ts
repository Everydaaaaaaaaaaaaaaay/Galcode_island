// Tauri 自动更新封装。
//
// 仅在桌面端 (isTauri) 起作用：浏览器（局域网客户端）模式下所有调用都 noop。
// 通过 dynamic import 把 plugin 模块按需加载，避免移动端 build 时 vite 把它打进
// bundle —— plugin 内部依赖 __TAURI_INTERNALS__ 并会试图调 invoke，浏览器里没用。
//
// 工作流程：
//   1. checkForUpdate()：调 plugin check()，返回 Update | null
//   2. 用户点"立即更新" → downloadAndInstall(onProgress) 开始下载
//   3. 下载完成后 plugin 自己安装（macOS：替换 .app，Windows: passive nsis）
//   4. install 完成 → relaunch() 重启应用让用户看到新版本

import { isTauri } from "./bridge";

export interface UpdateInfo {
  /// 远端 latest.json 里的版本号，例如 "0.2.0"
  version: string;
  /// 远端 release notes（plugin updater 使用 latest.json.notes 字段）
  body: string;
  /// 远端 latest.json 里的 pub_date（ISO 8601）
  date: string | null;
  /// plugin 给的当前应用版本（来自 tauri.conf.json）
  currentVersion: string;
}

export interface DownloadProgress {
  /// 已下载字节数
  downloaded: number;
  /// 总字节数（从 server 获取，可能为 0 表示未知）
  total: number;
}

interface PluginUpdate {
  version: string;
  body?: string | null;
  date?: string | null;
  currentVersion: string;
  downloadAndInstall: (
    onEvent?: (event: PluginDownloadEvent) => void,
  ) => Promise<void>;
}

type PluginDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/// 静态缓存最近一次 check 拿到的 Update 实例 —— downloadAndInstall 必须在同一个
/// 实例上调，不能新建。
let cachedUpdate: PluginUpdate | null = null;

/// 检查更新。返回 UpdateInfo（有新版）或 null（已是最新 / 检查失败 / 浏览器模式）。
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null;
  cachedUpdate = null;
  try {
    const mod = await import("@tauri-apps/plugin-updater");
    const upd = (await mod.check()) as PluginUpdate | null;
    if (!upd) return null;
    cachedUpdate = upd;
    return {
      version: upd.version,
      body: upd.body ?? "",
      date: upd.date ?? null,
      currentVersion: upd.currentVersion,
    };
  } catch (err) {
    // dev 模式下 plugin updater 会报 "expected a key in tauri.conf.json"
    // 等错误 —— 这种是预期的，不要抛
    console.warn("[updater] check failed:", err);
    return null;
  }
}

/// 下载并安装最近一次 check 拿到的更新。onProgress 接收下载进度。
/// 安装完成后调用方应该调 relaunchApp() 重启。
export async function downloadAndInstall(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  if (!isTauri) throw new Error("updater 仅在桌面端可用");
  if (!cachedUpdate) {
    throw new Error("没有待安装的更新（请先 checkForUpdate）");
  }

  let downloaded = 0;
  let total = 0;

  await cachedUpdate.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      downloaded = 0;
      onProgress?.({ downloaded, total });
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.({ downloaded, total });
    } else if (event.event === "Finished") {
      onProgress?.({ downloaded: total || downloaded, total: total || downloaded });
    }
  });

  // 安装完成；下一步由调用方决定 relaunch 时机
}

/// 重启应用让新版本生效。
export async function relaunchApp(): Promise<void> {
  if (!isTauri) return;
  const mod = await import("@tauri-apps/plugin-process");
  await mod.relaunch();
}
