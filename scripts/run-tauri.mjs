#!/usr/bin/env node
// 跨平台 tauri 启动器。
//
// 历史上 npm scripts 用 `PATH="$HOME/.cargo/bin:$PATH" tauri dev` 把 rustup 的
// cargo 推到 Homebrew 旧版前面（macOS）。但这种 inline env 赋值是 POSIX shell
// 语法，Windows cmd / PowerShell 不认识 —— cmd 把整段当成不存在的程序，
// dev 进程根本起不来，回到 prompt 没任何错误，特别坑。
//
// 这个 wrapper 用 node 处理：
//   - 把 ~/.cargo/bin 拼到 PATH 最前面（macOS 防 Homebrew 旧 cargo 优先；
//     Windows 上 rustup 装的 cargo 通常已在 PATH，加在最前也无害）
//   - shell:true 让 Windows 上 npm 装的 tauri.cmd 也能直接执行
//   - 透传 stdio + 退出码

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const sep = process.platform === "win32" ? ";" : ":";
const currentPath = process.env.PATH ?? process.env.Path ?? "";

const env = {
  ...process.env,
  PATH: `${cargoBin}${sep}${currentPath}`,
};

// npm run 已经把 ./node_modules/.bin 加到 PATH，"tauri" 能直接找到。
// shell:true 让 Windows 自动认 .cmd 后缀。
const child = spawn("tauri", args, {
  stdio: "inherit",
  env,
  shell: true,
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : code ?? 0);
});

child.on("error", (err) => {
  console.error("Failed to spawn tauri:", err);
  process.exit(1);
});
