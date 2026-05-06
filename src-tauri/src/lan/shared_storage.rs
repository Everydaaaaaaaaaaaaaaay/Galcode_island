// 跨设备共享的 zustand persist 镜像。
//
// 桌面端是唯一权威：
//   - 桌面端 webview 里的 zustand persist setItem(key, value) 时，会同时 invoke
//     lan_set_storage(key, value, source) 把这份 JSON 推到这里。
//   - 我们持久化到 <app_config_dir>/lan-storage.json，让重启后镜像不丢；
//     并 emit `storage://changed` 让所有 LAN 客户端 rehydrate 对应 store。
//
// 移动端 / 局域网客户端：
//   - 没自己的 localStorage（即便有，也是手机本地空的）。zustand 的 storage
//     adapter 直接走 invoke("lan_get_storage", { key }) → 拿到桌面端最新 JSON
//     做 hydrate。
//   - setItem 时 invoke("lan_set_storage", ...)，源标记为自己 clientId；
//     广播事件回来时按 source 比对避免自己 hydrate 自己的写入造成抖动。

use crate::lan::state::LanRuntimeState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PersistedStorage {
    pub entries: HashMap<String, String>,
}

pub fn storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("拿不到 app config dir: {e}"))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建 config dir 失败: {e}"))?;
    }
    Ok(dir.join("lan-storage.json"))
}

/// 启动时从磁盘加载持久化镜像。
pub fn load(app: &AppHandle) -> HashMap<String, String> {
    let path = match storage_path(app) {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return HashMap::new();
    };
    let parsed: PersistedStorage = serde_json::from_slice(&bytes).unwrap_or_default();
    parsed.entries
}

/// 写盘。原子写：先写 .tmp 再 rename。
pub fn save(app: &AppHandle, entries: &HashMap<String, String>) -> Result<(), String> {
    let path = storage_path(app)?;
    let payload = PersistedStorage {
        entries: entries.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("写 lan-storage.json.tmp 失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename lan-storage.json 失败: {e}"))?;
    Ok(())
}

/// 写盘 debounce 全局代数：每次 schedule_save 加 1，定时器到期时若代数已变更说明
/// 后面又有新写入，跳过本次落盘交给后到的写入。这样 N 次高频 set 只会触发 1 次
/// 写盘。zustand setState 在 agent 跑流式块时频率可达 10Hz，原本每次都 spawn
/// 线程做整个 JSON 序列化 + tmp 写 + rename 太重；800ms debounce 把它压到 ≤ 1Hz。
const SAVE_DEBOUNCE_MS: u64 = 800;
static SAVE_GENERATION: AtomicU64 = AtomicU64::new(0);

/// 安排一次延迟写盘。多次连续调用只让最后一次到期时真正写盘。
/// 内存 HashMap 由 caller 在调本函数前已经更新（移动端 invoke `lan_get_storage`
/// 立刻能拿到最新值，不依赖落盘）；落盘只是为了重启后恢复。
pub fn schedule_save(app: &AppHandle, lan: &Arc<LanRuntimeState>) {
    let my_gen = SAVE_GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    let app_cloned = app.clone();
    let storage = lan.shared_storage.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(SAVE_DEBOUNCE_MS)).await;
        // 代数已变 → 后面有人接力写，跳过
        if SAVE_GENERATION.load(Ordering::Relaxed) != my_gen {
            return;
        }
        // 拿快照（持锁时间最短，避免阻塞其它 invoke）
        let snapshot = match storage.lock() {
            Ok(m) => m.clone(),
            Err(_) => return,
        };
        // 文件 IO 用 spawn_blocking 不占 tokio worker
        let app_for_save = app_cloned.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = save(&app_for_save, &snapshot) {
                log::warn!("[lan] save shared storage failed: {e}");
            }
        })
        .await;
    });
}
