// LAN HTTP 服务的静态资源解析。
//
// Tauri 在 build 时会把 `frontendDist`（默认 `../dist`）嵌入到二进制里，运行时通过
// `app.asset_resolver()` 取——这正好让我们的 LAN 服务也能服务一份相同的 React
// 应用，无需在 Rust 侧再单独 include_dir 一份（节省 23MB binary 体积）。
//
// SPA 路由兜底：任何找不到的 path（不是 /api/*）都返回 index.html，让 React Router
// 自己处理（项目目前没用 router，但以后加了也不需要再改这里）。
//
// dev 模式注意：frontendDist 指向 ../dist 但 dev 时 Tauri webview 用的是 devUrl
// (http://localhost:1420 vite dev server)，dist 可能是旧的或不存在。第一次用 LAN
// 功能前请确保跑过一次 `npm run build:web` 让 dist 是最新版。

use tauri::AppHandle;

#[derive(Debug)]
pub struct StaticAsset {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

/// 根据请求 path 返回资源；找不到时尝试 index.html 兜底。
/// 都找不到（dist 不存在）返回 None — caller 给 503 + 友好提示。
pub fn resolve(app: &AppHandle, path: &str) -> Option<StaticAsset> {
    let normalized = normalize_path(path);
    if let Some(asset) = lookup(app, &normalized) {
        return Some(asset);
    }
    // SPA fallback：把任何看起来不像静态资源的请求都返回 index.html
    // （静态资源通常带 .扩展名，且大概率匹配第一个 lookup —— 这里再过一遍）
    if !normalized.contains('.') || normalized.is_empty() {
        return lookup(app, "index.html");
    }
    None
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim_start_matches('/');
    if trimmed.is_empty() {
        return "index.html".to_string();
    }
    // 防止 path traversal
    if trimmed.contains("..") {
        return "index.html".to_string();
    }
    trimmed.to_string()
}

fn lookup(app: &AppHandle, key: &str) -> Option<StaticAsset> {
    let resolver = app.asset_resolver();
    // AssetResolver::get 接收的是 webview-style path（前置 / 的不一定，文档不一致）
    // 试两种形式
    let attempts = [key.to_string(), format!("/{key}")];
    for attempt in &attempts {
        if let Some(asset) = resolver.get(attempt.clone()) {
            return Some(StaticAsset {
                bytes: asset.bytes,
                mime: guess_mime(key),
            });
        }
    }
    None
}

fn guess_mime(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".ttf") {
        "font/ttf"
    } else if lower.ends_with(".txt") {
        "text/plain; charset=utf-8"
    } else if lower.ends_with(".map") {
        "application/json; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

pub const NOT_BUILT_HTML: &str = r#"<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Galcode Island · LAN</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0b1224;color:#e7ecf5;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;}main{max-width:520px;text-align:center;line-height:1.7;}code{background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:6px;font-family:ui-monospace,monospace;}h1{font-size:20px;margin:0 0 12px;}p{color:#9aa6c0;font-size:14px;margin:6px 0;}</style></head><body><main><h1>前端资源未就绪</h1><p>桌面端尚未生成生产版前端。请在桌面端项目根目录运行：</p><p><code>npm run build:web</code></p><p>命令完成后刷新本页即可。</p></main></body></html>"#;
