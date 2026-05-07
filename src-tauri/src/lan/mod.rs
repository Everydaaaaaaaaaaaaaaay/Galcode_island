// 局域网移动端访问模块。
//
// 入口：register_state（lib.rs setup 调用）+ commands.rs 暴露的 lan_* IPC 命令。
//
// 子模块：
//   - config   持久化（lan.json 里的密码哈希、token 列表、端口、enabled）
//   - state    运行时状态（HTTP 句柄、项目快照镜像）
//   - server   tiny_http 启停循环
//   - api      REST 路由 + handler
//   - auth     密码哈希 / token 生成 / 常时间比较
//   - network  局域网 IP 探测

pub mod api;
pub mod auth;
pub mod config;
pub mod dispatch;
pub mod event_bus;
pub mod network;
pub mod server;
pub mod shared_storage;
pub mod state;
pub mod static_assets;

pub use state::LanRuntimeState;
