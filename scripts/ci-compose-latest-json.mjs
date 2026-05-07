// CI 用：合并各平台构建产生的 latest.json fragment，输出两份完整 latest.json：
//   - dist-release/latest.github.json  url 指向 github.com/.../releases/download/<tag>/<file>
//   - dist-release/latest.r2.json      url 指向 R2 公域 R2_PUBLIC_BASE/<file>
//
// 输入：artifacts/<job>/latest.json （job = macos-arm64 / windows-x64）
// 环境变量：
//   VERSION              发版版本号（不带 v 前缀）
//   RELEASE_NOTES_FILE   Release Notes 文件路径（→ notes 字段）
//   R2_PUBLIC_BASE       R2 公域（如 https://galcode.harucdn.com）
//   GITHUB_REPOSITORY    owner/repo（GHA 自动注入）

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const artifactsDir = path.join(rootDir, "artifacts");
const outputDir = path.join(rootDir, "dist-release");

const version = (process.env.VERSION || "").replace(/^v/, "");
if (!version) {
  console.error("VERSION env var required");
  process.exit(1);
}

const notesFile = process.env.RELEASE_NOTES_FILE;
let notes = `Galcode Island v${version}`;
if (notesFile && existsSync(notesFile)) {
  notes = readFileSync(notesFile, "utf8").trim() || notes;
}

const r2Base = (process.env.R2_PUBLIC_BASE || "").replace(/\/+$/, "");
if (!r2Base) {
  console.error("R2_PUBLIC_BASE env var required");
  process.exit(1);
}

const ghRepo = process.env.GITHUB_REPOSITORY || "sjyinzju/Galcode_island";
const ghReleaseBase = `https://github.com/${ghRepo}/releases/download/v${version}`;

if (!existsSync(artifactsDir)) {
  console.error(`No artifacts dir: ${artifactsDir}`);
  process.exit(1);
}

const mergedPlatforms = {};
let pubDate = new Date().toISOString();

for (const jobDir of readdirSync(artifactsDir)) {
  const jsonPath = path.join(artifactsDir, jobDir, "latest.json");
  if (!existsSync(jsonPath)) continue;
  const obj = JSON.parse(readFileSync(jsonPath, "utf8"));
  if (obj.pub_date) pubDate = obj.pub_date;
  if (obj.platforms) {
    for (const [platKey, platVal] of Object.entries(obj.platforms)) {
      mergedPlatforms[platKey] = platVal;
    }
  }
}

if (Object.keys(mergedPlatforms).length === 0) {
  console.error("No platform entries found in artifacts/*/latest.json");
  process.exit(1);
}

function makeVariant(baseUrl) {
  const platforms = {};
  for (const [platKey, platVal] of Object.entries(mergedPlatforms)) {
    // 原 url 形如 .../galcode_island_0.2.0_aarch64.app.tar.gz
    // 只取文件名，拼新 base
    const fileName = path.posix.basename(platVal.url || "");
    platforms[platKey] = {
      signature: platVal.signature || "",
      url: `${baseUrl}/${fileName}`,
    };
  }
  return { version, notes, pub_date: pubDate, platforms };
}

mkdirSync(outputDir, { recursive: true });

writeFileSync(
  path.join(outputDir, "latest.github.json"),
  JSON.stringify(makeVariant(ghReleaseBase), null, 2) + "\n",
);

writeFileSync(
  path.join(outputDir, "latest.r2.json"),
  JSON.stringify(makeVariant(r2Base), null, 2) + "\n",
);

console.log(`✓ Composed latest.json for platforms: ${Object.keys(mergedPlatforms).join(", ")}`);
console.log(`  - ${outputDir}/latest.github.json  (→ ${ghReleaseBase}/)`);
console.log(`  - ${outputDir}/latest.r2.json      (→ ${r2Base}/)`);
