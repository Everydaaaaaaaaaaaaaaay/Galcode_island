// 在 tauri build（无 APPLE_SIGNING_IDENTITY 模式）之后运行：手动签名 bundle 内
// 所有原生二进制 + 主可执行文件 + 整个 .app。
//
// 为什么不用 tauri build 自带的签名？
//   tauri 内部走 `codesign --deep --force`，会把我们已经为 bundled CLI（claude /
//   codex / opencode）单独附加好的 JIT entitlements 一并覆盖掉 —— 公证仍能通过，
//   但用户启动后 .NET / Node V8 在 hardened runtime 下因为没有 allow-jit 会
//   crash。所以：
//     1. tauri build 时屏蔽 APPLE_SIGNING_IDENTITY 让它跳过 deep codesign
//     2. 这里从最深层 binary 开始逐层签：JIT binary 加 entitlements，其它正常签
//     3. 最后签整个 .app
//
// 这个脚本踩过两个坑（参考项目教训）：
//   - 必须**先签内部二进制再签主二进制再签 .app**，反过来 codesign 会重新覆盖
//   - 只对 Mach-O 文件做 codesign（用 magic number 探测），跳过普通文件 / JS / 文本

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, openSync, readSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const entitlementsPath = path.join(rootDir, "src-tauri", "resources", "runtime-entitlements.plist");

const signingIdentity = (process.env.APPLE_SIGNING_IDENTITY || "").trim();
if (!signingIdentity) {
  console.log("APPLE_SIGNING_IDENTITY not set, skipping bundle signing.");
  process.exit(0);
}

if (!existsSync(entitlementsPath)) {
  console.error("runtime-entitlements.plist not found at", entitlementsPath);
  process.exit(1);
}

// `tauri build --target X` 把产物写到 target/{target}/release/bundle/macos；
// 不带 --target 时写到 target/release/bundle/macos。两处都要找。
function resolveBundleBase() {
  const candidates = [
    path.join(rootDir, "src-tauri", "target", "release", "bundle", "macos"),
  ];
  const targetRoot = path.join(rootDir, "src-tauri", "target");
  try {
    for (const entry of readdirSync(targetRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "release" || entry.name === "debug") continue;
      candidates.push(path.join(targetRoot, entry.name, "release", "bundle", "macos"));
    }
  } catch {}
  return candidates.find((candidate) => existsSync(candidate));
}

const bundleBase = resolveBundleBase();
if (!bundleBase) {
  console.error("Bundle directory not found under src-tauri/target/**/release/bundle/macos");
  process.exit(1);
}
console.log(`Bundle base: ${path.relative(rootDir, bundleBase)}`);

const appBundles = readdirSync(bundleBase)
  .filter((name) => name.endsWith(".app"))
  .map((name) => path.join(bundleBase, name));

if (!appBundles.length) {
  console.error("No .app bundles found in", bundleBase);
  process.exit(1);
}

// Mach-O magic numbers（包括 fat / 单架构 / 小端 / 大端）
function isMachOBinary(filePath) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    const bytesRead = readSync(fd, buf, 0, 4, 0);
    if (bytesRead < 4) return false;
    const magic = buf.readUInt32BE(0);
    return (
      magic === 0xfeedface || // 32-bit
      magic === 0xfeedfacf || // 64-bit
      magic === 0xcefaedfe || // 32-bit reversed
      magic === 0xcffaedfe || // 64-bit reversed
      magic === 0xcafebabe || // fat
      magic === 0xbebafeca    // fat reversed
    );
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// 需要 JIT entitlements 的二进制名（无扩展名的可执行文件）
// claude / codex / opencode 都是 Node.js 起的 V8 JIT 程序；node 是它们的 runtime；
// spawn-helper 是 N-API 子进程脚手架，部分版本也走 JIT。
const JIT_BINARY_NAMES = new Set([
  "claude",
  "codex",
  "opencode",
  "node",
  "spawn-helper",
]);

function needsJitEntitlements(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  // .node 原生模块不需要 JIT entitlements（它们由父 node 进程加载，继承父的 entitlements）
  if (ext === ".node") return false;
  // 无扩展名的可执行二进制按名字白名单
  return !ext && JIT_BINARY_NAMES.has(name);
}

function findAllNativeBinaries(dir) {
  const results = [];
  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".node" && isMachOBinary(fullPath)) {
        results.push(fullPath);
      } else if (!ext && isMachOBinary(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

// 读 Cargo.toml 的 [package].name 推主二进制名（默认 bin name = package name）
function resolveMainBinaryName() {
  const cargoToml = path.join(rootDir, "src-tauri", "Cargo.toml");
  try {
    const raw = readFileSync(cargoToml, "utf8");
    const m = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch {}
  return "galcode_island";
}

const mainBinaryName = resolveMainBinaryName();

for (const appBundle of appBundles) {
  console.log(`\nSigning ${path.basename(appBundle)}...`);

  // 1. 签名 Resources 内所有原生二进制（由内向外，先签最深层）
  const resourcesDir = path.join(appBundle, "Contents", "Resources");
  const binaries = findAllNativeBinaries(resourcesDir);
  console.log(`  Found ${binaries.length} native binaries in Resources`);

  let signedCount = 0;
  for (const binary of binaries) {
    const relative = path.relative(appBundle, binary);
    const withEntitlements = needsJitEntitlements(binary);
    const args = [
      "--force",
      "--options", "runtime",
      "--timestamp",
      "--sign", signingIdentity,
    ];
    if (withEntitlements) {
      args.push("--entitlements", entitlementsPath);
    }
    args.push(binary);

    try {
      execFileSync("codesign", args, { stdio: "pipe" });
      console.log(`  Signed: ${relative}${withEntitlements ? " (JIT)" : ""}`);
      signedCount++;
    } catch (error) {
      const message = String(error.stderr || error.message || "").trim();
      console.error(`  Failed: ${relative} (${message})`);
      process.exit(1);
    }
  }

  // 2. 签名主可执行文件
  const mainBinary = path.join(appBundle, "Contents", "MacOS", mainBinaryName);
  if (existsSync(mainBinary)) {
    try {
      execFileSync(
        "codesign",
        [
          "--force",
          "--options", "runtime",
          "--timestamp",
          "--sign", signingIdentity,
          mainBinary,
        ],
        { stdio: "pipe" },
      );
      console.log(`  Signed: Contents/MacOS/${mainBinaryName}`);
      signedCount++;
    } catch (error) {
      const message = String(error.stderr || error.message || "").trim();
      console.error(`  Failed to sign main binary: ${message}`);
      process.exit(1);
    }
  } else {
    console.warn(
      `  ⚠ Main binary not found at Contents/MacOS/${mainBinaryName}`
      + ` —— Cargo.toml package name 可能跟实际产物名不一致；检查 src-tauri/Cargo.toml [package].name`,
    );
  }

  // 3. 签名整个 .app bundle
  try {
    execFileSync(
      "codesign",
      [
        "--force",
        "--options", "runtime",
        "--timestamp",
        "--sign", signingIdentity,
        appBundle,
      ],
      { stdio: "pipe" },
    );
    console.log(`  Signed app bundle: ${path.basename(appBundle)}`);
  } catch (error) {
    const message = String(error.stderr || error.message || "").trim();
    console.error(`  Failed to sign app bundle: ${message}`);
    process.exit(1);
  }

  // 4. 验证
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", appBundle], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (verify.status === 0) {
    console.log(`  Verification passed. (${signedCount} binaries signed)`);
  } else {
    console.error(`  Verification failed: ${(verify.stderr || "").trim()}`);
    process.exit(1);
  }
}

console.log("\nBundle signing complete.");
