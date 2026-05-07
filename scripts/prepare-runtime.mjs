#!/usr/bin/env node
// 把 Claude Code / OpenCode / Codex 三个 CLI 的 prebuilt binary 拉到
// src-tauri/resources/runtime/<platform>-<arch>/<kind>/<binary>
// 供 Tauri bundle 打进 .app/.dmg/.msi。dev 模式也跑（让 dev 期 resolver 直接用 staged
// binary，避免 macOS GUI 下 PATH 缩水找不到 CLI）。
//
// 用法：
//   node scripts/prepare-runtime.mjs              # 当前平台
//   node scripts/prepare-runtime.mjs --skip-claude  # 跳过 claude（许可证敏感时）
//   node scripts/prepare-runtime.mjs --sign       # CI release：强制 npm install + codesign
//   node scripts/prepare-runtime.mjs --force      # 已 staged 也重装
//
// 优先级（非 release 模式）：
//   1. runtime/<kind>/<binary> 已存在 → 跳过（幂等）
//   2. 系统 PATH 上有同名 native binary（≥100KB 真 binary，非 wrapper）→ 复制过来
//   3. 否则 npm install 到临时目录 + 复制
// CI release（--sign）跳过第 2 步，强制 npm install 拿确定版本，避免开发机本地版本污染发布产物。
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

// 在系统 PATH 上找同名 native binary，仅在大小 ≥100KB 时返回（避免 npm 全局
// 安装的 wrapper 脚本，比如 claude 的 launcher 是几十行 shell，复制过来跑不起来）。
// 命中率较低——绝大多数 CLI npm 全局装出来都是 wrapper script。
function findGlobalNativeBinary(name) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const exe = isWindows ? `${name}.exe` : name;
  const result = spawnSync(lookup, [exe], {
    encoding: "utf8",
    // Windows 下 where 是 cmd 内置（也有同名 exe）；shell:true 更稳
    shell: process.platform === "win32",
  });
  if (result.status !== 0) return null;
  const lines = (result.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const candidate of lines) {
    try {
      const stat = statSync(candidate);
      if (!stat.isFile()) continue;
      // 100KB 阈值跟 findBinaryRecursive 一致：过滤 npm wrapper / .bin shim
      if (stat.size < 1024 * 100) continue;
      return candidate;
    } catch {}
  }
  return null;
}

// 用户报告 "即使电脑上已经有 codex、Claude 等，启动时也会重新安装" 的真正解：
// 检查 npm 全局 root（`npm root -g`）下有没有同款包的 platform sub-package 已经
// 装过。这跟我们自己 `npm install --prefix tmp` 做的是同一件事，只是直接从用户
// 已经装好的全局位置拷贝，省下几秒 npm install 时间。
let cachedNpmGlobalRoot;
function getNpmGlobalRoot() {
  if (cachedNpmGlobalRoot !== undefined) return cachedNpmGlobalRoot;
  const result = spawnSync("npm", ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    cachedNpmGlobalRoot = null;
    return null;
  }
  const root = (result.stdout || "").trim();
  cachedNpmGlobalRoot = root && existsSync(root) ? root : null;
  return cachedNpmGlobalRoot;
}

// 在 npm 全局 root 里找 platform-specific 的 native binary。
// 例：opencode-ai 装到 `<root>/opencode-ai/`，里面会拉对应 platform 的 sub-package
// `@opencode-ai/opencode-darwin-arm64/bin/opencode`。findBinaryRecursive 已经做了
// 100KB 阈值校验，自动跳过外层 wrapper。
function findGlobalNpmBinary(packageName, binaryBaseName) {
  const root = getNpmGlobalRoot();
  if (!root) return null;
  const packageDir = path.join(root, packageName);
  if (!existsSync(packageDir)) return null;
  return findBinaryRecursive(packageDir, binaryName(binaryBaseName));
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

/// 幂等检查：runtime/<kind>/<binary> 已存在 → 这一份已经 stage 过，
/// 跳过 npm install + 重 stage。避免 CI 里 prepare-runtime --sign 之后
/// tauri build 通过 beforeBuildCommand 二次跑 prepare-runtime 时覆盖签名。
/// `--force` 标志强制重装（用户改了 CLI 版本号需要拉新版时用）。
const wantForce = args.includes("--force");
function isAlreadyStaged(kind) {
  if (wantForce) return false;
  const exe = path.join(runtimeDir, kind, binaryName(kind));
  return existsSync(exe);
}

// CI release（--sign）总是走 npm install 拿确定版本，避免开发机本地版本进入发布产物。
// 非 release 模式按优先级复用：
//   1. 系统 PATH 上的真 native binary（极少见，比如手动 build / 直接下载 release）
//   2. npm 全局 root 下已经装过的 platform sub-package binary（典型场景，省 npm install 时间）
async function tryReuseGlobal(kind, npmPackage) {
  if (wantSign) return false;
  const onPath = findGlobalNativeBinary(kind);
  if (onPath) {
    console.log(`  → reusing native binary on PATH: ${onPath}`);
    await stageBinary(kind, onPath);
    return true;
  }
  const inGlobal = findGlobalNpmBinary(npmPackage, kind);
  if (inGlobal) {
    console.log(`  → reusing npm-global package binary: ${inGlobal}`);
    await stageBinary(kind, inGlobal);
    return true;
  }
  return false;
}

async function prepareOpencode(tmpDir) {
  if (skipOpencode) {
    console.log("[opencode] skipped");
    return;
  }
  if (isAlreadyStaged("opencode")) {
    console.log("[opencode] already staged, skipping (--force to re-install)");
    return;
  }
  console.log("[opencode]");
  if (await tryReuseGlobal("opencode", "opencode-ai")) return;
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
  if (isAlreadyStaged("codex")) {
    console.log("[codex] already staged, skipping (--force to re-install)");
    return;
  }
  console.log("[codex]");
  if (await tryReuseGlobal("codex", "@openai/codex")) return;
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
  if (isAlreadyStaged("claude")) {
    console.log("[claude] already staged, skipping (--force to re-install)");
    return;
  }
  console.log("[claude]");
  // 注意：claude 全局装的也是 node wrapper script（很小），findGlobalNativeBinary
  // 会按 100KB 阈值过滤掉，所以这里通常 fall through 到 npm install 路径。
  // 即便如此 npm install 出来的同样是 wrapper —— bundle claude 需要带 node + 整个
  // 包，这是已知 TODO。当前回退：runtime 没 staged → resolver fallback PATH。
  if (await tryReuseGlobal("claude", "@anthropic-ai/claude-code")) return;
  npmInstall(tmpDir, "@anthropic-ai/claude-code");
  const fileName = binaryName("claude");
  const found = findBinaryRecursive(path.join(tmpDir, "node_modules"), fileName);
  if (!found) {
    console.warn(
      `  ⚠ claude binary not found — Claude Code 是 node 脚本而非原生 binary，暂未 bundle。`
      + ` 用户需自行 npm i -g @anthropic-ai/claude-code，应用会通过系统 PATH 调用。`,
    );
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
