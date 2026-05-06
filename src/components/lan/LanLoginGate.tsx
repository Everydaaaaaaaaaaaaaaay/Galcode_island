// 浏览器（非 Tauri）模式下的登录拦截层。
//
// 渲染逻辑：
//   - 仅在 isBrowserLan 时启用；Tauri webview 直接 children 透传不渲染
//   - 已有 token：bootstrap 调 /api/me 验证；通过则进主界面
//   - 没 token / token 失效：显示登录卡（密码 + 设备别名 → POST /api/login → setLanToken）
//
// 视觉风格匹配桌面端：用同一个磨砂玻璃 + 渐变背景，避免移动端跳出感。

import React from "react";
import { motion } from "framer-motion";
import { isBrowserLan, getLanToken, setLanToken, invoke, BridgeUnauthorizedError } from "../../lib/bridge";

interface Props {
  children: React.ReactNode;
}

type State = "checking" | "needs-login" | "ready";

export function LanLoginGate({ children }: Props): JSX.Element {
  const [state, setState] = React.useState<State>(() =>
    isBrowserLan ? (getLanToken() ? "checking" : "needs-login") : "ready",
  );
  const [pwInput, setPwInput] = React.useState("");
  const [labelInput, setLabelInput] = React.useState(() => {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem("galcode_lan_device_label") || guessLabel();
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (state !== "checking") return;
    let cancelled = false;
    void (async () => {
      try {
        await invoke("lan_get_state");
        if (!cancelled) setState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof BridgeUnauthorizedError) {
          setLanToken(null);
          setState("needs-login");
        } else {
          // 网络错误：还显示登录界面，让用户重试
          setState("needs-login");
          setError("无法连接到桌面端服务，请检查网络。");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  const handleLogin = async (): Promise<void> => {
    if (!pwInput) {
      setError("请输入密码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwInput, label: labelInput.trim() }),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { token: string };
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("galcode_lan_device_label", labelInput.trim());
      }
      setLanToken(data.token);
      setPwInput("");
      setState("ready");
    } catch (err) {
      setError("登录失败：" + (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (state === "ready") return <>{children}</>;

  // checking / needs-login 都显示同一个面板，避免闪烁
  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden text-zinc-900 dark:text-zinc-100">
      {/* 跟桌面端一致的渐变光斑背景 */}
      <div className="pointer-events-none absolute inset-0 bg-slate-50 dark:bg-[#0B1120]">
        <motion.div
          className="absolute -top-1/4 -left-1/4 h-[60%] w-[60%] rounded-full bg-sky-200/30 blur-3xl dark:bg-sky-400/15"
          animate={{ x: [0, 30, -20, 15, 0], y: [0, -20, 25, -10, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-1/4 -right-1/4 h-[50%] w-[50%] rounded-full bg-amber-200/25 blur-3xl dark:bg-amber-400/10"
          animate={{ x: [0, -25, 15, -10, 0], y: [0, 20, -30, 15, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-white/60 bg-white/70 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-800/60"
        >
          <header className="flex flex-col items-center gap-2 text-center">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-sky-400 to-purple-400 shadow-md shadow-sky-400/35" />
            <h1 className="text-lg font-semibold tracking-tight text-zinc-800 dark:text-zinc-100">
              Galcode Island
            </h1>
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {state === "checking" ? "验证身份中…" : "请输入访问密码进入桌面端"}
            </p>
          </header>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">密码</label>
            <input
              type="password"
              value={pwInput}
              onChange={(e) => setPwInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleLogin();
              }}
              autoFocus
              autoComplete="current-password"
              placeholder="桌面端「设置 → 局域网移动端访问」里设置的密码"
              className="rounded-lg border border-black/5 bg-white/60 px-3 py-2.5 text-sm text-zinc-800 outline-none transition-all focus:border-sky-400/50 focus:bg-white/85 focus:ring-2 focus:ring-sky-400/15 dark:border-white/5 dark:bg-slate-800/55 dark:text-zinc-100 dark:focus:bg-slate-800/75"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              设备别名（让桌面端识别这台设备）
            </label>
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="例如：我的 iPhone"
              className="rounded-lg border border-black/5 bg-white/60 px-3 py-2.5 text-sm text-zinc-800 outline-none transition-all focus:border-sky-400/50 focus:bg-white/85 focus:ring-2 focus:ring-sky-400/15 dark:border-white/5 dark:bg-slate-800/55 dark:text-zinc-100 dark:focus:bg-slate-800/75"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-rose-300/40 bg-rose-100/40 px-3 py-2 text-[11px] leading-relaxed text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleLogin()}
            disabled={busy || state === "checking"}
            className="rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-sky-400/30 transition-all hover:shadow-sky-400/45 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "登录中…" : state === "checking" ? "正在验证…" : "进 入"}
          </button>

          <p className="text-center text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
            登录后 token 将缓存在本设备 30 天，避免重复输入。 <br />
            桌面端可在「设置 → 局域网移动端访问」一键撤销所有设备。
          </p>
        </motion.div>
      </div>
    </main>
  );
}

function guessLabel(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac 浏览器";
  if (/Windows/.test(ua)) return "Windows 浏览器";
  return "浏览器";
}
