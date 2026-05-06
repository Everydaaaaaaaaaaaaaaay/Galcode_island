// 局域网 HTTP API 路由 + 处理。
//
// 路由层级（server.rs 调度时按顺序判断）：
//   1. OPTIONS    → CORS 预检（server.rs 直接处理）
//   2. /api/events → SSE 长连接（server.rs 直接处理，不走本模块）
//   3. /api/login    → 验证密码 → 颁发 token（公开）
//   4. /api/health   → 健康检查（公开）
//   5. /api/cmd/<name> → 通用 IPC 透传（鉴权后走 dispatch）
//   6. /api/logout   → 撤销当前 token（鉴权）
//   7. /api/me       → token 校验（鉴权）
//   8. 其它路径      → 静态资源（server.rs 走 static_assets）
//
// 鉴权：除登录、健康检查外都需要 Authorization: Bearer <token>，token 命中后
// 续期 30 天（避免常用设备过期）。

use crate::lan::auth;
use crate::lan::config::{self, StoredToken};
use crate::lan::dispatch;
use crate::lan::event_bus;
use crate::lan::state::LanRuntimeState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Request};

#[derive(Debug)]
pub struct ApiResponse {
    pub status: u16,
    pub body: Vec<u8>,
    pub content_type: String,
}

impl ApiResponse {
    pub fn json(status: u16, value: Value) -> Self {
        Self {
            status,
            body: serde_json::to_vec(&value).unwrap_or_default(),
            content_type: "application/json; charset=utf-8".to_string(),
        }
    }
    pub fn json_ok(value: Value) -> Self {
        Self::json(200, value)
    }
    pub fn err(status: u16, message: &str) -> Self {
        Self::json(status, json!({ "error": message }))
    }
}

#[derive(Clone)]
pub struct HandlerCtx {
    pub app: AppHandle,
}

/// 主入口（处理所有 /api/* 请求）。
pub async fn handle(
    ctx: &HandlerCtx,
    method: Method,
    path: &str,
    query: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
) -> ApiResponse {
    if path == "/api/health" {
        return ApiResponse::json_ok(json!({ "ok": true, "name": "galcode-island-lan" }));
    }
    if path == "/api/login" && method == Method::Post {
        return handle_login(ctx, &body);
    }

    // 鉴权：优先 Authorization header，fallback 到 query token=（长轮询用 fetch 自带
    // header 没问题，但保留 query 兼容旧客户端 / 调试 / EventSource fallback）
    let token = extract_bearer(headers)
        .or_else(|| query_token(query))
        .unwrap_or_default();
    if token.is_empty() {
        return ApiResponse::err(401, "missing token");
    }
    if !verify_and_touch_token(ctx, &token) {
        return ApiResponse::err(401, "invalid or expired token");
    }

    match (&method, path) {
        (&Method::Get, "/api/me") => ApiResponse::json_ok(json!({ "ok": true })),
        (&Method::Post, "/api/logout") => handle_logout(ctx, &token),
        (&Method::Get, "/api/events/poll") => handle_events_poll(ctx, query).await,
        (&Method::Post, p) if p.starts_with("/api/cmd/") => {
            let cmd = p.trim_start_matches("/api/cmd/").to_string();
            handle_cmd(ctx, &cmd, body).await
        }
        _ => ApiResponse::err(404, "not found"),
    }
}

fn query_token(query: &str) -> Option<String> {
    parse_query(query)
        .into_iter()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v)
        .filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// 鉴权辅助
// ---------------------------------------------------------------------------

fn extract_bearer(headers: &[(String, String)]) -> Option<String> {
    for (k, v) in headers {
        if k.eq_ignore_ascii_case("authorization") {
            let trimmed = v.trim();
            if let Some(rest) = trimmed.strip_prefix("Bearer ") {
                return Some(rest.trim().to_string());
            }
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

pub fn verify_and_touch_token(ctx: &HandlerCtx, token: &str) -> bool {
    let mut cfg = config::load(&ctx.app);
    cfg.purge_expired_tokens();
    let now = config::unix_now();
    let mut hit = false;
    for stored in cfg.tokens.iter_mut() {
        if auth::constant_time_eq(&stored.token, token) {
            stored.expires_at = now + auth::TOKEN_TTL_SECS;
            hit = true;
            break;
        }
    }
    if hit {
        let _ = config::save(&ctx.app, &cfg);
    }
    hit
}

// ---------------------------------------------------------------------------
// 登录 / 登出
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct LoginBody {
    password: String,
    #[serde(default)]
    label: String,
}

fn handle_login(ctx: &HandlerCtx, body: &[u8]) -> ApiResponse {
    let parsed: LoginBody = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return ApiResponse::err(400, "invalid json"),
    };
    let mut cfg = config::load(&ctx.app);
    if !cfg.has_password() {
        return ApiResponse::err(403, "服务端尚未设置密码");
    }
    let candidate = auth::hash_password(&cfg.password_salt, &parsed.password);
    if !auth::constant_time_eq(&candidate, &cfg.password_hash) {
        return ApiResponse::err(401, "密码错误");
    }
    let now = config::unix_now();
    let token = auth::generate_token();
    let label = if parsed.label.trim().is_empty() {
        "移动端".to_string()
    } else {
        parsed.label.trim().chars().take(60).collect::<String>()
    };
    cfg.tokens.push(StoredToken {
        token: token.clone(),
        expires_at: now + auth::TOKEN_TTL_SECS,
        label,
        created_at: now,
    });
    cfg.purge_expired_tokens();
    if let Err(e) = config::save(&ctx.app, &cfg) {
        log::warn!("save lan.json failed after login: {e}");
    }
    ApiResponse::json_ok(json!({
        "token": token,
        "expiresAt": now + auth::TOKEN_TTL_SECS,
    }))
}

fn handle_logout(ctx: &HandlerCtx, token: &str) -> ApiResponse {
    let mut cfg = config::load(&ctx.app);
    cfg.tokens.retain(|t| !auth::constant_time_eq(&t.token, token));
    let _ = config::save(&ctx.app, &cfg);
    ApiResponse::json_ok(json!({ "ok": true }))
}

// ---------------------------------------------------------------------------
// 通用 IPC 透传
// ---------------------------------------------------------------------------

async fn handle_cmd(ctx: &HandlerCtx, cmd: &str, body: Vec<u8>) -> ApiResponse {
    let args: Value = if body.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return ApiResponse::err(400, &format!("invalid json: {e}")),
        }
    };
    match dispatch::dispatch(ctx.app.clone(), cmd, args).await {
        Ok(value) => ApiResponse {
            status: 200,
            body: serde_json::to_vec(&value).unwrap_or_default(),
            content_type: "application/json; charset=utf-8".to_string(),
        },
        Err(msg) => ApiResponse::err(400, &msg),
    }
}

// ---------------------------------------------------------------------------
// tiny_http 适配
// ---------------------------------------------------------------------------

pub fn read_request(req: &mut Request) -> (Method, String, String, Vec<(String, String)>, Vec<u8>) {
    let method = req.method().clone();
    let url = req.url().to_string();
    let mut split = url.splitn(2, '?');
    let path = split.next().unwrap_or(&url).to_string();
    let query = split.next().unwrap_or("").to_string();
    let headers: Vec<(String, String)> = req
        .headers()
        .iter()
        .map(|h| (h.field.as_str().to_string(), h.value.as_str().to_string()))
        .collect();
    let mut body = Vec::new();
    let _ = std::io::Read::read_to_end(req.as_reader(), &mut body);
    (method, path, query, headers, body)
}

pub fn make_headers(content_type: &str) -> Vec<Header> {
    vec![
        Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
        Header::from_bytes(
            &b"Access-Control-Allow-Headers"[..],
            b"Content-Type, Authorization",
        )
        .unwrap(),
        Header::from_bytes(
            &b"Access-Control-Allow-Methods"[..],
            b"GET, POST, OPTIONS",
        )
        .unwrap(),
        Header::from_bytes(&b"Cache-Control"[..], b"no-store").unwrap(),
    ]
}

pub fn parse_query(query: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if query.is_empty() {
        return out;
    }
    for kv in query.split('&') {
        let mut split = kv.splitn(2, '=');
        let k = split.next().unwrap_or("").to_string();
        let v = split.next().unwrap_or("").to_string();
        out.push((url_decode(&k), url_decode(&v)));
    }
    out
}

fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'+' {
            out.push(' ');
            i += 1;
        } else if b == b'%' && i + 2 < bytes.len() {
            let hex = &s[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte as char);
                i += 3;
                continue;
            }
            out.push(b as char);
            i += 1;
        } else {
            out.push(b as char);
            i += 1;
        }
    }
    out
}

// ---------------------------------------------------------------------------
// 长轮询事件
// ---------------------------------------------------------------------------

const POLL_TIMEOUT_SECS: u64 = 25;

async fn handle_events_poll(ctx: &HandlerCtx, query: &str) -> ApiResponse {
    // since=<u64>; 缺省 0（拿全部历史）。但首次连接时客户端应该传 since=current
    // 避免拿到几百条 backlog；前端 bridge.ts 会先拿 current_seq 再开始 poll。
    let since: u64 = parse_query(query)
        .into_iter()
        .find(|(k, _)| k == "since")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);

    let lan = ctx.app.state::<Arc<LanRuntimeState>>();
    let bus = lan.event_bus.clone();
    // poll 是阻塞调用：用 spawn_blocking 避免霸占 tokio worker
    let stamped: Vec<event_bus::Stamped> = tokio::task::spawn_blocking(move || {
        bus.poll(since, Duration::from_secs(POLL_TIMEOUT_SECS))
    })
    .await
    .unwrap_or_default();

    let lan2 = ctx.app.state::<Arc<LanRuntimeState>>();
    let current = lan2.event_bus.current_seq();
    ApiResponse::json_ok(event_bus::encode_poll_response(&stamped, current))
}
