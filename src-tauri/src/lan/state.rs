// 局域网服务运行时状态：HTTP 服务句柄 + 项目快照（前端推上来的 tabs 镜像）+
// 事件总线（SSE 转发）+ 共享 zustand storage 镜像。

use crate::lan::event_bus::EventBus;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotItem {
    pub id: String,
    pub title: String,
    pub agent: String,
    /// 工作目录；null 表示尚未选择
    pub project_path: Option<String>,
    pub last_user_prompt: Option<String>,
    pub last_active_at: u64,
    pub created_at: u64,
    /// idle/running/thinking/processing/done/error
    pub status: String,
    /// idle/running/done/error/suggesting
    pub ui_state: String,
    /// 后端 sessionId（前端 AgentSession UUID），可选
    pub session_id: Option<String>,
    /// backend native session id（Claude/Codex/OpenCode 各自的真实 session 标识）
    pub agent_native_session_id: Option<String>,
    pub has_unread: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsSnapshot {
    pub items: Vec<ProjectSnapshotItem>,
    pub active_tab_id: Option<String>,
    pub updated_at: u64,
}

/// 当前 HTTP 服务运行句柄。Mutex 包住，让 commands.rs 能 take/replace。
#[derive(Default)]
pub struct ServerHandle {
    pub thread: Option<JoinHandle<()>>,
    pub stop_flag: Option<Arc<AtomicBool>>,
    pub running_port: Option<u16>,
}

/// LAN 服务运行时状态（注册到 Tauri State<Arc<LanRuntimeState>>）。
pub struct LanRuntimeState {
    pub server: Mutex<ServerHandle>,
    /// 前端推过来的项目快照镜像；HTTP /api/projects 直接返回它。
    pub projects: Arc<Mutex<ProjectsSnapshot>>,
    /// SSE 事件总线：Tauri emit → 浏览器 listen 的桥梁
    pub event_bus: Arc<EventBus>,
    /// zustand persist 数据镜像：key 是 store name（"galcode_tabs" /
    /// "agent-settings-storage" / "agent-profile-storage"），value 是序列化后的
    /// JSON 字符串。桌面端是唯一权威 —— 桌面 webview 里 zustand setItem 会同步
    /// 推到这里；移动端读这份镜像 hydrate；任一端写入都会通过 storage://changed
    /// 事件广播给其它客户端 rehydrate。
    pub shared_storage: Arc<Mutex<HashMap<String, String>>>,
}

impl Default for LanRuntimeState {
    fn default() -> Self {
        Self {
            server: Mutex::new(ServerHandle::default()),
            projects: Arc::new(Mutex::new(ProjectsSnapshot::default())),
            event_bus: Arc::new(EventBus::new()),
            shared_storage: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
