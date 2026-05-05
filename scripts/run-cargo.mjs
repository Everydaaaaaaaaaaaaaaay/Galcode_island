#!/usr/bin/env node
// 跨平台 cargo 启动器（cwd 固定 src-tauri）。
//
// 跟 run-tauri.mjs 同样的原因：原本的 `cd src-tauri && PATH=... cargo ...`
// inline env 赋值在 Windows cmd 不工作。这里用 node 显式 spawn，PATH 注入
// ~/.cargo/bin 防 Homebrew 旧 cargo 优先（macOS 主要痛点）。
//
// 用法：
//   node scripts/run-cargo.mjs check
//   node scripts/run-cargo.mjs clippy --all-targets -- -D warnings

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tauriDir = path.resolve(__dirname, "..", "src-tauri");
const args = process.argv.slice(2);

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const sep = process.platform === "win32" ? ";" : ":";
const currentPath = process.env.PATH ?? process.env.Path ?? "";

const env = {
  ...process.env,
  PATH: `${cargoBin}${sep}${currentPath}`,
};

const child = spawn("cargo", args, {
  stdio: "inherit",
  env,
  cwd: tauriDir,
  shell: true,
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : code ?? 0);
});

child.on("error", (err) => {
  console.error("Failed to spawn cargo:", err);
  process.exit(1);
});
