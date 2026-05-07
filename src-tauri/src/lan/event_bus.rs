// LAN 客户端的事件总线（长轮询模型，比 SSE 在 tiny_http 上更易实现）。
//
// 工作流程：
//   1. lib.rs setup 时 register_forwarders(app) 给每个白名单事件名挂 Tauri listener
//   2. listener 把 (event_name, payload_json) 送到 EventBus.append → 写历史 + 通知 waiter
//   3. 客户端 GET /api/events/poll?token=…&since=<lastSeq>
//      - 立即检查历史里 seq > since 的事件 → 有就直接返回
//      - 没有 → 注册一个 mpsc::Sender 到 waiters，阻塞 timeout（25s）等新事件，超时
//        或被唤醒后再次检查历史并返回（哪怕空数组也算正常 —— 客户端立刻发下一轮）
//   4. 客户端拿到响应后：
//      - 把每条 dispatch 给 listener
//      - 用响应里的 maxSeq 当下轮 since
//      - 立刻发下一轮（fetch keep-alive）
//
// 比 SSE 的优势：
//   - 不需要黑入 tiny_http 的流式响应 API，每个 long-poll 是个普通短 JSON 响应
//   - 客户端断线 / 切前后台后无缝恢复（重连时带 since 拿到历史 backlog）
//   - 网络代理 / 浏览器对长连接的兼容更好（25s 超时单次响应不会被中间代理截断）

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex};
use std::time::{Duration, Instant};

const HISTORY_CAP: usize = 256;

pub const FORWARDED_EVENTS: &[&str] = &[
    "agent://status-changed",
    "agent://session-complete",
    "agent://error",
    "agent://result-raw",
    "agent://cleanup",
    "galcode://cli-output",
    "lan://project-launched",
    // 注意：storage://changed / removed 不再走 forwarder 转发。
    // 它们由 commands::lan_set_storage / lan_remove_storage 直接 append 到
    // EventBus（移动端长轮询拉到），并按 notify_webview 决定是否再 app.emit
    // 给 Tauri webview。桌面 webview 自己发起 setItem 时设 notify_webview=false，
    // 避免"自己 emit 自己又收到"的无意义 IPC 回程。
];

#[derive(Clone, Debug)]
pub struct Stamped {
    pub seq: u64,
    pub event: String,
    pub payload: Value,
}

pub struct EventBus {
    history: Mutex<VecDeque<Stamped>>,
    next_seq: AtomicU64,
    waiters: Mutex<Vec<std::sync::mpsc::SyncSender<()>>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            history: Mutex::new(VecDeque::with_capacity(HISTORY_CAP)),
            next_seq: AtomicU64::new(1),
            waiters: Mutex::new(Vec::new()),
        }
    }

    pub fn append(&self, event: String, payload: Value) {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let stamped = Stamped { seq, event, payload };
        if let Ok(mut hist) = self.history.lock() {
            hist.push_back(stamped);
            while hist.len() > HISTORY_CAP {
                hist.pop_front();
            }
        }
        // 唤醒所有 waiter；逐个 try_send（容量 1，已通知就跳过）；之后清空 waiter 列表
        let mut waiters = match self.waiters.lock() {
            Ok(w) => w,
            Err(_) => return,
        };
        for tx in waiters.drain(..) {
            let _ = tx.try_send(());
        }
    }

    /// 立即拿历史里 seq > since 的事件；没有就返回空。
    fn drain_since(&self, since: u64) -> Vec<Stamped> {
        let hist = match self.history.lock() {
            Ok(h) => h,
            Err(_) => return Vec::new(),
        };
        hist.iter().filter(|s| s.seq > since).cloned().collect()
    }

    /// 长轮询：先看历史；空就阻塞等到新事件或 timeout。
    pub fn poll(&self, since: u64, timeout: Duration) -> Vec<Stamped> {
        let immediate = self.drain_since(since);
        if !immediate.is_empty() {
            return immediate;
        }
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        if let Ok(mut waiters) = self.waiters.lock() {
            waiters.push(tx);
        }
        let started = Instant::now();
        // 用 recv_timeout：被唤醒就立刻重新读历史
        let _ = rx.recv_timeout(timeout);
        let _ = started; // 仅保留以便未来加日志
        self.drain_since(since)
    }

    /// 当前最新 seq（客户端首次连接时拿这个当 since 起点，避免拉到一堆 backlog）。
    pub fn current_seq(&self) -> u64 {
        self.next_seq.load(Ordering::Relaxed).saturating_sub(1)
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

/// 把一组 Stamped 包装成 JSON 响应：
///   { "events": [{seq, event, payload}, ...], "maxSeq": 42 }
pub fn encode_poll_response(events: &[Stamped], current_max: u64) -> Value {
    let max_seq = events.iter().map(|s| s.seq).max().unwrap_or(current_max);
    json!({
        "events": events.iter().map(|s| json!({
            "seq": s.seq,
            "event": s.event,
            "payload": s.payload,
        })).collect::<Vec<_>>(),
        "maxSeq": max_seq,
    })
}

/// lib.rs setup 时调用：给每个 FORWARDED_EVENTS 注册 Tauri listener，事件 payload
/// 转 JSON 后塞进 EventBus。
pub fn register_forwarders(app: &tauri::AppHandle) {
    use tauri::{Listener, Manager};
    let lan = app.state::<std::sync::Arc<crate::lan::state::LanRuntimeState>>();
    let bus = lan.event_bus.clone();
    for event_name in FORWARDED_EVENTS {
        let bus_cloned = bus.clone();
        let event_owned = event_name.to_string();
        app.listen(event_name.to_string(), move |event| {
            let payload_str = event.payload();
            let payload_value: Value = serde_json::from_str(payload_str)
                .unwrap_or_else(|_| Value::String(payload_str.to_string()));
            bus_cloned.append(event_owned.clone(), payload_value);
        });
    }
}
