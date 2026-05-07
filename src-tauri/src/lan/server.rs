// 局域网 HTTP 服务的启停循环。
//
// 使用 tiny_http，0 异步开销：
//   - 启动时 std::thread::spawn 出一条 acceptor 线程，主循环里 recv_timeout(500ms)
//     周期检查 stop_flag，让停服时能干净退出（tiny_http 没有官方 shutdown）
//   - 每个请求再 spawn 一条短线程处理（IPC 透传 / 长轮询事件 / 静态文件流式发送）
//
// 路由优先级（每个 request 走一遍）：
//   1. OPTIONS → CORS 预检直接返回 204
//   2. /api/* → api::handle（dispatch IPC / 登录 / 长轮询）
//   3. 其它路径 → 静态文件（dist/ 通过 asset_resolver）

use crate::lan::api::{self, ApiResponse, HandlerCtx};
use crate::lan::static_assets::{self, NOT_BUILT_HTML};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server};

/// 启动 HTTP 服务。
/// 返回 (实际端口, acceptor 线程句柄, stop flag)。caller 把它写到 LanRuntimeState 里。
pub fn spawn_server(
    app: &AppHandle,
    port: u16,
) -> Result<(u16, std::thread::JoinHandle<()>, Arc<AtomicBool>), String> {
    let server = Server::http(format!("0.0.0.0:{port}"))
        .map_err(|e| format!("绑定 0.0.0.0:{port} 失败: {e}"))?;
    let actual_port = server
        .server_addr()
        .to_ip()
        .map(|sa| sa.port())
        .unwrap_or(port);

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    let ctx = HandlerCtx { app: app.clone() };

    let handle = std::thread::Builder::new()
        .name("galcode-lan-server".into())
        .spawn(move || run_loop(server, ctx, stop_for_thread))
        .map_err(|e| format!("起 acceptor 线程失败: {e}"))?;

    Ok((actual_port, handle, stop))
}

fn run_loop(server: Server, ctx: HandlerCtx, stop: Arc<AtomicBool>) {
    log::info!("[lan] HTTP server loop started");
    while !stop.load(Ordering::Relaxed) {
        match server.recv_timeout(Duration::from_millis(500)) {
            Ok(Some(req)) => {
                let ctx_cloned = ctx.clone();
                std::thread::spawn(move || {
                    handle_one(ctx_cloned, req);
                });
            }
            Ok(None) => {}
            Err(e) => {
                log::warn!("[lan] recv_timeout error: {e}");
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    log::info!("[lan] HTTP server loop exiting");
}

fn handle_one(ctx: HandlerCtx, mut req: tiny_http::Request) {
    let (method, path, query, headers, body) = api::read_request(&mut req);

    // CORS 预检
    if method == Method::Options {
        let resp = Response::from_string("")
            .with_status_code(204)
            .with_header(
                Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
            )
            .with_header(
                Header::from_bytes(
                    &b"Access-Control-Allow-Headers"[..],
                    &b"Content-Type, Authorization"[..],
                )
                .unwrap(),
            )
            .with_header(
                Header::from_bytes(
                    &b"Access-Control-Allow-Methods"[..],
                    &b"GET, POST, OPTIONS"[..],
                )
                .unwrap(),
            );
        let _ = req.respond(resp);
        return;
    }

    // /api/* 走 JSON handler（dispatch / login / poll 都在里面）
    if path.starts_with("/api/") {
        let api_resp: ApiResponse = tauri::async_runtime::block_on(api::handle(
            &ctx, method, &path, &query, &headers, body,
        ));
        respond_json(req, api_resp);
        return;
    }

    // 其它：静态文件（前端 React 产物）
    serve_static(&ctx, req, &path);
}

fn respond_json(req: tiny_http::Request, api_resp: ApiResponse) {
    let mut response = Response::from_data(api_resp.body).with_status_code(api_resp.status);
    for header in api::make_headers(&api_resp.content_type) {
        response = response.with_header(header);
    }
    if let Err(e) = req.respond(response) {
        log::warn!("[lan] respond failed: {e}");
    }
}

fn serve_static(ctx: &HandlerCtx, req: tiny_http::Request, path: &str) {
    if let Some(asset) = static_assets::resolve(&ctx.app, path) {
        let mut response = Response::from_data(asset.bytes).with_status_code(200);
        for header in api::make_headers(asset.mime) {
            response = response.with_header(header);
        }
        if let Err(e) = req.respond(response) {
            log::warn!("[lan] static respond failed: {e}");
        }
        return;
    }
    let mut response = Response::from_string(NOT_BUILT_HTML).with_status_code(503);
    for header in api::make_headers("text/html; charset=utf-8") {
        response = response.with_header(header);
    }
    let _ = req.respond(response);
}

/// 通知 acceptor 线程退出，并 join。
pub fn stop_server(
    thread_handle: Option<std::thread::JoinHandle<()>>,
    stop_flag: Option<Arc<AtomicBool>>,
) {
    if let Some(flag) = stop_flag {
        flag.store(true, Ordering::Relaxed);
    }
    if let Some(handle) = thread_handle {
        let _ = handle.join();
    }
}
