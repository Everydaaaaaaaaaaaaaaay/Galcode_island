// 局域网移动端访问的持久化配置（密码哈希、端口、token 列表）。
//
// 文件位置：<app_config_dir>/lan.json
//   - 密码不存明文，只存 sha256(salt || password) 的哈希
//   - tokens 列表跟随密码持久化：客户端登录后即使重启 app 也能继续用，免重输密码
//   - 改密码会清空所有 tokens，强制所有移动端重新登录（安全语义）

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredToken {
    pub token: String,
    /// Unix 时间戳（秒），过期时间。0 表示永不过期（一般不用）。
    pub expires_at: u64,
    /// 客户端 User-Agent 摘要 / 自填别名，方便用户识别和撤销。
    #[serde(default)]
    pub label: String,
    /// 创建时间戳，UI 展示用。
    #[serde(default)]
    pub created_at: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LanConfig {
    /// 密码盐（hex）。空字符串表示从未设置过密码。
    #[serde(default)]
    pub password_salt: String,
    /// 密码哈希（hex）。空 => 未设置密码 => 不允许启用服务。
    #[serde(default)]
    pub password_hash: String,
    /// 监听端口；默认 39001。
    #[serde(default = "default_port")]
    pub port: u16,
    /// 是否启用：用户在设置面板显式开启。
    #[serde(default)]
    pub enabled: bool,
    /// 已登录设备的 token 列表。
    #[serde(default)]
    pub tokens: Vec<StoredToken>,
}

fn default_port() -> u16 {
    39001
}

impl LanConfig {
    pub fn has_password(&self) -> bool {
        !self.password_hash.is_empty() && !self.password_salt.is_empty()
    }

    pub fn purge_expired_tokens(&mut self) {
        let now = unix_now();
        self.tokens.retain(|t| t.expires_at == 0 || t.expires_at > now);
    }
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("拿不到 app config dir: {e}"))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建 config dir 失败: {e}"))?;
    }
    Ok(dir.join("lan.json"))
}

pub fn load(app: &AppHandle) -> LanConfig {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(_) => return LanConfig::default(),
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return LanConfig::default();
    };
    let mut cfg: LanConfig = serde_json::from_slice(&bytes).unwrap_or_default();
    cfg.purge_expired_tokens();
    if cfg.port == 0 {
        cfg.port = default_port();
    }
    cfg
}

pub fn save(app: &AppHandle, cfg: &LanConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?;
    // 原子写：先写 .tmp 再 rename，避免中途崩溃导致 lan.json 损坏丢密码
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("写 lan.json.tmp 失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename lan.json 失败: {e}"))?;
    Ok(())
}
