#!/usr/bin/env node
// 把 Claude Code / OpenCode / Codex 三个 CLI 的 prebuilt binary 拉到
// src-tauri/resources/runtime/<platform>-<arch>/<kind>/<binary>
// 供 Tauri bundle 打进 .app/.dmg/.msi。dev 模式不需要跑这个。
//
// 用法：
//   node scripts/prepare-runtime.mjs              # 当前平台
//   node scripts/prepare-runtime.mjs --skip-claude  # 跳过 claude（许可证敏感时）
//
// 设计：
//   - 用 npm install 到临时目录，避免污染主项目 node_modules
//   - 每个 CLI 在它自己的 npm 包里有平台相关的 binary subpackage
//     (例: @opencode-ai/opencode-darwin-arm64 / @openai/codex-darwin-arm64)
//   - 找到 binary 后复制到 resources/runtime/<key>/<kind>/<binary>
//   - chmod 0o755（Unix 上 npm 包里 binary 默认就是可执行的，保险起见）
//   - 失败容错：单个 CLI 失败不影响其它两个

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, openSync, readdirSync, readSync, closeSync, statSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };
const archMap = { x64: "x64", arm64: "arm64" };

const platform = platformMap[process.platform] || process.platform;
const arch = archMap[process.arch] || process.arch;
const runtimeKey = `${platform}-${arch}`;
const runtimeDir = path.join(rootDir, "src-tauri", "resources", "runtime", runtimeKey);
const isWindows = platform === "windows";

const args = process.argv.slice(2);
const skipClaude = args.includes("--skip-claude");
const skipCodex = args.includes("--skip-codex");
const skipOpencode = args.includes("--skip-opencode");
// --sign：仅 macOS 用；公证流水线需要 bundled binaries 已经各自签好名 + 附 JIT
// entitlements，否则后续 fix-bundle-signatures.mjs 重新 codesign 时整个 .app 会
// 因为内部 binary 没签过被 Gatekeeper 拒绝。dev / 本地 build 时不传 --sign。
const wantSign = args.includes("--sign");

function binaryName(base) {
  return isWindows ? `${base}.exe` : base;
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

function npmInstall(tmpDir, packageName) {
  // --no-save / --no-package-lock：不污染 lockfile
  // --prefix tmpDir：装到 tmp 目录里
  // shell: true 在 Windows 必须开 —— spawnSync 不带 shell 时找不到 npm.cmd / npx.cmd
  console.log(`  → npm install ${packageName}`);
  const result = spawnSync(
    "npm",
    ["install", "--no-save", "--no-package-lock", "--no-fund", "--no-audit", "--prefix", tmpDir, packageName],
    { stdio: "inherit", encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status !== 0) {
    throw new Error(`npm install ${packageName} failed (exit ${result.status})`);
  }
}

function findBinaryRecursive(startDir, fileName, maxDepth = 6) {
  // 平台 subpackage 一般在 node_modules/<scope>/<pkg>-<platform>-<arch>/bin/
  // 不同包结构不一样，递归找最稳妥
  if (!existsSync(startDir)) return null;
  const stack = [{ dir: startDir, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        // 排除明显的 launcher 脚本（参考项目踩过坑：node_modules/.bin/<name> 是 shim）
        try {
          const stat = statSync(full);
          if (stat.size > 1024 * 100) {
            // 100KB+ 大概率是真 binary 不是 shim
            return full;
          }
        } catch {}
      }
      if (entry.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return null;
}

async function stageBinary(kind, sourcePath) {
  const destDir = path.join(runtimeDir, kind);
  await ensureDir(destDir);
  const dest = path.join(destDir, binaryName(kind));
  await copyFile(sourcePath, dest);
  if (!isWindows) {
    await chmod(dest, 0o755);
  }
  console.log(`  ✓ ${kind} → ${path.relative(rootDir, dest)}`);
  return dest;
}

async function prepareOpencode(tmpDir) {
  if (skipOpencode) {
    console.log("[opencode] skipped");
    return;
  }
  console.log("[opencode]");
  npmInstall(tmpDir, "opencode-ai");
  const fileName = binaryName("opencode");
  const found = findBinaryRecursive(path.join(tmpDir, "node_modules"), fileName);
  if (!found) {
    throw new Error(`opencode binary not found under ${tmpDir}/node_modules`);
  }
  await stageBinary("opencode", found);
}

async function prepareCodex(tmpDir) {
  if (skipCodex) {
    console.log("[codex] skipped");
    return;
  }
  console.log("[codex]");
  npmInstall(tmpDir, "@openai/codex");
  const fileName = binaryName("codex");
  const found = findBinaryRecursive(path.join(tmpDir, "node_modules"), fileName);
  if (!found) {
    throw new Error(`codex binary not found under ${tmpDir}/node_modules`);
  }
  await stageBinary("codex", found);
}

async function prepareClaude(tmpDir) {
  if (skipClaude) {
    console.log("[claude] skipped (use --skip-claude / Anthropic 专有许可证敏感时建议跳过)");
    return;
  }
  console.log("[claude]");
  npmInstall(tmpDir, "@anthropic-ai/claude-code");
  const fileName = binaryName("claude");
  const found = findBinaryRecursive(path.join(tmpDir, "node_modules"), fileName);
  if (!found) {
    // claude-code 可能是 node 启动的 js 脚本，不是 native binary —— 这种情况也需要 node bundle
    // 当前简化版策略：找不到就跳过，让用户自己安装
    console.warn(`  ⚠ claude binary not found — Claude Code 看起来是 node 脚本而非原生 binary，暂未 bundle，用户需自行 npm i -g @anthropic-ai/claude-code`);
    return;
  }
  await stageBinary("claude", found);
}

async function main() {
  console.log(`Preparing runtime for ${runtimeKey} → ${path.relative(rootDir, runtimeDir)}`);

  // 无条件创建 runtime 目录 + 写一个占位文件。
  // 原因：tauri.conf.json 的 bundle.resources 配的 glob `resources/runtime/**/*`
  // 在 tauri-build 阶段必须匹配到至少一个文件；fresh clone 后该目录不存在，
  // 即便所有 CLI 都安装失败，至少有这个占位让 cargo build 不挂。
  // 占位文件本身不入库（整个 runtime 目录被 .gitignore），bundle 时会被
  // 一起打进去（几十字节，无害）。
  await ensureDir(runtimeDir);
  await writeFile(
    path.join(runtimeDir, ".keep"),
    "tauri bundle.resources glob placeholder; safe to delete after a successful CLI stage.\n",
  );

  // 临时安装目录用 OS tmp，避免污染主项目
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "galcode-runtime-"));
  console.log(`(tmp install: ${tmpDir})`);

  try {
    const tasks = [
      ["opencode", () => prepareOpencode(tmpDir)],
      ["codex", () => prepareCodex(tmpDir)],
      ["claude", () => prepareClaude(tmpDir)],
    ];
    let failed = 0;
    for (const [name, fn] of tasks) {
      try {
        await fn();
      } catch (error) {
        failed += 1;
        console.error(`  ✗ ${name} failed: ${error.message}`);
      }
    }
    // 不 throw：即便全失败，bundle 出来的 .exe 仍可 fallback 到 PATH 上
    // 用户全局安装的 CLI（resolve_*_binary 会查 PATH）。失败只 warn，让
    // 后续 build 能继续；用户从产出 dmg/msi 启动时如果 PATH 也没有再报错。
    if (failed === tasks.length) {
      console.warn(
        `\n⚠ All ${tasks.length} runtime preparations failed. Bundle 不会包含任何 CLI binary —— ` +
          `产出的 .app/.exe 启动后只能依赖用户全局安装的 claude / codex / opencode（系统 PATH 上）。`,
      );
    } else if (failed > 0) {
      console.log(
        `\nDone with ${failed}/${tasks.length} failures. Bundle 会缺这些 CLI 的 binary，用户需要自己装。`,
      );
    } else {
      console.log("\nDone.");
    }

    // macOS + --sign：对 staged 的 native binaries 做 codesign + 附加 JIT entitlements。
    // 公证要求 .app 内每个 Mach-O 都已经签名；fix-bundle-signatures.mjs 在
    // tauri build 之后会再补签一次，但仅在每个 binary 已经先签过的前提下成立
    // （未签过的 binary tauri 内部的 codesign --force 流程会拿不到锚点）。
    if (wantSign && platform === "darwin") {
      const signingIdentity = (process.env.APPLE_SIGNING_IDENTITY || "").trim();
      if (!signingIdentity) {
        console.warn("--sign 已传但 APPLE_SIGNING_IDENTITY 为空；跳过 macOS bundled binary 签名。");
      } else {
        const signed = signMacOSBundledBinaries(runtimeDir, signingIdentity);
        if (signed) {
          console.log(`\nSigned ${signed} bundled native binaries with "${signingIdentity}".`);
        } else {
          console.log("\nNo bundled native binaries to sign.");
        }
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------- macOS bundled binary 签名（仅 --sign 流水线用） ----------

function isMachOBinary(filePath) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    const bytesRead = readSync(fd, buf, 0, 4, 0);
    if (bytesRead < 4) return false;
    const magic = buf.readUInt32BE(0);
    return (
      magic === 0xfeedface ||
      magic === 0xfeedfacf ||
      magic === 0xcefaedfe ||
      magic === 0xcffaedfe ||
      magic === 0xcafebabe ||
      magic === 0xbebafeca
    );
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function findNativeBinaries(baseDir) {
  const found = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".node" && isMachOBinary(full)) {
        found.push(full);
      } else if (!ext && isMachOBinary(full)) {
        found.push(full);
      }
    }
  }
  walk(baseDir);
  return found;
}

function signMacOSBundledBinaries(baseDir, identity) {
  if (!existsSync(baseDir)) return 0;
  const binaries = findNativeBinaries(baseDir);
  if (!binaries.length) return 0;

  const entitlementsPath = path.join(rootDir, "src-tauri", "resources", "runtime-entitlements.plist");
  const hasEntitlements = existsSync(entitlementsPath);
  if (!hasEntitlements) {
    console.warn(
      "Warning: src-tauri/resources/runtime-entitlements.plist not found；签名时不附加 JIT entitlements，"
      + "Node.js / V8 在 hardened runtime 下会 crash。",
    );
  }

  console.log(`\nSigning ${binaries.length} native binaries for macOS notarization...`);
  let signed = 0;
  for (const binary of binaries) {
    const relative = path.relative(baseDir, binary);
    try {
      const codesignArgs = [
        "--force",
        "--options", "runtime",
        "--timestamp",
        "--sign", identity,
      ];
      // 可执行二进制（非 .node）需要 JIT entitlements
      if (hasEntitlements && path.extname(binary).toLowerCase() !== ".node") {
        codesignArgs.push("--entitlements", entitlementsPath);
      }
      codesignArgs.push(binary);
      execFileSync("codesign", codesignArgs, { stdio: "pipe" });
      console.log(`  Signed: ${relative}${codesignArgs.includes("--entitlements") ? " (JIT)" : ""}`);
      signed += 1;
    } catch (error) {
      const msg = String(error.stderr || error.message || "").trim();
      console.warn(`  Skipped: ${relative} (${msg || "codesign failed"})`);
    }
  }
  return signed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
