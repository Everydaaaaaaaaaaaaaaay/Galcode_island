// 设置面板里的"局域网访问"区。
//
// 功能：
//   - 设置 / 修改密码：必须 ≥ 4 位；改密自动撤销所有已登录设备
//   - 端口（默认 39001）
//   - 启用 / 禁用开关：未设密码时禁用按钮 + tooltip 提示先设密码
//   - 列出局域网 URL（点击复制）
//   - 列出已登录设备（label + token 前 6 位 + 过期时间），可一键全部撤销

import React from "react";
import { useLanStore } from "../../stores/useLanStore";

// 移动端 text-base 防 iOS focus 放大；桌面端 sm:text-sm 保密度
const inputCls =
  "rounded-lg border border-black/5 bg-white/50 px-3 py-2.5 text-base text-zinc-800 outline-none transition-all focus:border-sky-400/50 focus:bg-white/80 focus:ring-2 focus:ring-sky-400/15 sm:py-2 sm:text-sm dark:border-white/5 dark:bg-slate-800/50 dark:text-zinc-100 dark:focus:border-sky-400/40 dark:focus:bg-slate-800/70 dark:focus:ring-sky-400/10";

function formatDate(secs: number): string {
  if (!secs) return "—";
  const d = new Date(secs * 1000);
  // YYYY-MM-DD HH:mm
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  isVisible: boolean;
}

export function LanAccessPanel({ isVisible }: Props): JSX.Element {
  const state = useLanStore((s) => s.state);
  const refresh = useLanStore((s) => s.refresh);
  const setPassword = useLanStore((s) => s.setPassword);
  const clearPassword = useLanStore((s) => s.clearPassword);
  const setPort = useLanStore((s) => s.setPort);
  const setEnabled = useLanStore((s) => s.setEnabled);
  const revokeAll = useLanStore((s) => s.revokeAll);
  const loading = useLanStore((s) => s.loading);

  const [pwInput, setPwInput] = React.useState("");
  const [pw2Input, setPw2Input] = React.useState("");
  const [portInput, setPortInput] = React.useState("39001");
  const [actionMsg, setActionMsg] = React.useState<{ kind: "info" | "ok" | "err"; text: string } | null>(null);
  const [copyHit, setCopyHit] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isVisible) {
      void refresh();
    }
  }, [isVisible, refresh]);

  React.useEffect(() => {
    if (state) setPortInput(String(state.port));
  }, [state?.port]);

  const flash = (kind: "info" | "ok" | "err", text: string) => {
    setActionMsg({ kind, text });
    window.setTimeout(() => setActionMsg(null), 3500);
  };

  const handleSavePassword = async () => {
    if (pwInput.length < 4) {
      flash("err", "密码至少 4 位");
      return;
    }
    if (pwInput !== pw2Input) {
      flash("err", "两次输入的密码不一致");
      return;
    }
    try {
      await setPassword(pwInput);
      setPwInput("");
      setPw2Input("");
      flash("ok", "密码已保存。所有已登录设备需重新输入密码。");
    } catch (e) {
      flash("err", String(e));
    }
  };

  const handleClearPassword = async () => {
    if (!window.confirm("清空密码会停止局域网服务，并撤销所有已登录设备。确定吗？")) return;
    try {
      await clearPassword();
      flash("ok", "已清空密码并停止服务。");
    } catch (e) {
      flash("err", String(e));
    }
  };

  const handleSavePort = async () => {
    const port = parseInt(portInput, 10);
    if (Number.isNaN(port) || port < 1024 || port > 65535) {
      flash("err", "端口需为 1024–65535 的整数");
      return;
    }
    if (state?.running && port !== state.port) {
      if (!window.confirm("修改端口需要先停止再重启服务才能生效，是否继续保存？")) return;
    }
    try {
      await setPort(port);
      flash("ok", "端口已保存。如服务正在运行请重启服务以应用。");
    } catch (e) {
      flash("err", String(e));
    }
  };

  const handleToggle = async (next: boolean) => {
    try {
      await setEnabled(next);
      flash("ok", next ? "服务已启用" : "服务已停止");
    } catch (e) {
      flash("err", String(e));
    }
  };

  const handleRevokeAll = async () => {
    if (!window.confirm("撤销所有已登录设备？所有移动端将需要重新输入密码。")) return;
    try {
      await revokeAll();
      flash("ok", "已撤销所有设备");
    } catch (e) {
      flash("err", String(e));
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyHit(url);
      window.setTimeout(() => setCopyHit(null), 1500);
    } catch {
      flash("err", "复制失败，请手动选中复制");
    }
  };

  const hasPassword = state?.hasPassword ?? false;
  const running = state?.running ?? false;
  const enableDisabled = !hasPassword || loading;

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        局域网移动端访问
      </h3>
      <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        在桌面端启动一个本地 HTTP 服务，让同一局域网下的手机 / 平板通过浏览器进入移动端
        界面来管理项目。务必先设置密码 —— 没有密码不允许启用。其它设备登录后会缓存
        token，下次打开免重输。
      </p>

      {/* 密码区 */}
      <div className="flex flex-col gap-2 rounded-lg border border-black/5 bg-white/30 p-3 dark:border-white/5 dark:bg-slate-800/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
            访问密码{hasPassword ? "（已设置）" : "（尚未设置）"}
          </span>
          {hasPassword && (
            <button
              type="button"
              onClick={handleClearPassword}
              className="text-[11px] text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
              disabled={loading}
            >
              清空密码并停服
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="password"
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            placeholder={hasPassword ? "输入新密码以修改" : "至少 4 位"}
            className={inputCls}
            autoComplete="new-password"
          />
          <input
            type="password"
            value={pw2Input}
            onChange={(e) => setPw2Input(e.target.value)}
            placeholder="再输一次"
            className={inputCls}
            autoComplete="new-password"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSavePassword}
            disabled={loading || pwInput.length === 0}
            className="rounded-md border border-sky-400/50 bg-sky-500/10 px-3 py-1 text-[11px] font-medium text-sky-700 transition-all hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-300/40 dark:text-sky-300"
          >
            {hasPassword ? "更改密码" : "设置密码"}
          </button>
        </div>
        {hasPassword && (
          <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
            修改密码会撤销所有已登录设备。
          </p>
        )}
      </div>

      {/* 端口区 */}
      <div className="flex flex-col gap-2 rounded-lg border border-black/5 bg-white/30 p-3 dark:border-white/5 dark:bg-slate-800/30">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">监听端口</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1024}
            max={65535}
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            className={`${inputCls} w-32`}
          />
          <button
            type="button"
            onClick={handleSavePort}
            disabled={loading}
            className="rounded-md border border-zinc-300/60 bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-700 transition-all hover:bg-zinc-200 disabled:opacity-50 dark:border-white/10 dark:bg-slate-700/60 dark:text-zinc-200 dark:hover:bg-slate-700/80"
          >
            保存端口
          </button>
        </div>
      </div>

      {/* 服务开关 + URL 列表 */}
      <div className="flex flex-col gap-3 rounded-lg border border-black/5 bg-white/30 p-3 dark:border-white/5 dark:bg-slate-800/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {running ? "服务正在运行" : "服务未启动"}
            </span>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {running
                ? `监听 0.0.0.0:${state?.runningPort ?? state?.port}`
                : hasPassword
                  ? "点击右侧开关启动 HTTP 服务"
                  : "请先在上方设置密码"}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={running}
            disabled={enableDisabled}
            title={enableDisabled ? "请先设置密码" : ""}
            onClick={() => handleToggle(!running)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              running ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                running ? "translate-x-[18px]" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {running && state && state.urls.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              用手机浏览器打开以下任一地址 →
            </span>
            <ul className="flex flex-col gap-1">
              {state.urls.map((url) => (
                <li
                  key={url}
                  className="flex items-center justify-between gap-2 rounded-md border border-black/5 bg-white/60 px-2 py-1.5 text-xs text-zinc-700 dark:border-white/5 dark:bg-slate-900/40 dark:text-zinc-200"
                >
                  <code className="break-all font-mono text-[11px]">{url}</code>
                  <button
                    type="button"
                    onClick={() => void handleCopy(url)}
                    className="shrink-0 rounded border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700 transition-all hover:bg-sky-500/20 dark:text-sky-300"
                  >
                    {copyHit === url ? "已复制" : "复制"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {running && state && state.urls.length === 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            未检测到局域网 IPv4 地址。请确认本机已连接 Wi-Fi 或有线网络（10.x / 192.168.x /
            172.16-31.x）。
          </p>
        )}

        {!running && state && state.interfaces.length > 0 && (
          <p className="break-all text-[11px] text-zinc-500 dark:text-zinc-400">
            探测到本机 IP：{state.interfaces.join(" / ")}
          </p>
        )}
      </div>

      {/* 已登录设备 */}
      {state && state.devices.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-black/5 bg-white/30 p-3 dark:border-white/5 dark:bg-slate-800/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
              已登录设备（{state.devices.length}）
            </span>
            <button
              type="button"
              onClick={handleRevokeAll}
              className="text-[11px] text-rose-600 hover:underline dark:text-rose-400"
              disabled={loading}
            >
              全部撤销
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {state.devices.map((d) => (
              <li
                key={d.tokenPreview}
                className="flex items-center justify-between rounded border border-black/5 bg-white/40 px-2 py-1 text-[11px] text-zinc-600 dark:border-white/5 dark:bg-slate-900/30 dark:text-zinc-300"
              >
                <span>
                  <b className="font-medium text-zinc-800 dark:text-zinc-100">
                    {d.label || "未命名"}
                  </b>{" "}
                  · token <code className="font-mono">{d.tokenPreview}…</code>
                </span>
                <span className="text-zinc-400 dark:text-zinc-500">
                  到期 {formatDate(d.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actionMsg && (
        <p
          className={`text-[11px] ${
            actionMsg.kind === "ok"
              ? "text-emerald-600 dark:text-emerald-400"
              : actionMsg.kind === "err"
                ? "text-rose-600 dark:text-rose-400"
                : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {actionMsg.text}
        </p>
      )}
    </section>
  );
}
