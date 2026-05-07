# Galcode Island

> 一个面向本地代码项目的桌面 Agent 工作台，把 Claude Code、OpenCode 和 Codex 放进同一套桌宠式界面里。

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

Galcode Island 是一个 Tauri 桌面应用，用来在本地项目中运行多个编码 Agent CLI。它不重新实现 Agent 能力，而是直连各 CLI 的原生协议，再补上一层项目化桌面体验：多 tab、会话持久化、结构化流式输出、全局搜索、结果总结、后续追问，以及会随任务状态变化的桌宠反馈。

这份 README 按当前代码重新分析后撰写，避免继续沿用旧文档里已经过时的功能描述。涉及实现细节时，以 `src/` 和 `src-tauri/src/` 下的源码为准。

## 功能概览

- 统一接入 Claude Code、OpenCode、Codex 三个本地 Agent backend。
- 每个项目会话独立成 tab，拥有自己的工作目录、backend、流式记录、结果卡片和原生会话续接 ID。
- 将 Agent 过程归一成结构化 block：用户输入、正文、思考、命令、命令输出、todo、文件、diff、工具调用、状态、stderr 和错误。
- 中栏紧凑展示长命令输出、stderr 和 diff，点击后在右栏查看完整详情。
- 通过 Zustand localStorage 持久化 tab、近期 block、结果摘要、历史记录、设置和个人档案。
- 关闭 tab 时归档为历史会话，可从历史面板恢复项目路径、backend、上次结果和可用的 native session/thread id。
- 支持两种搜索：左栏跨项目/历史/输出搜索，以及当前 tab 内的 `Cmd/Ctrl+F` 页内查找。
- 可选接入 OpenAI 兼容 LLM，用于中文总结、凉宫春日风格反馈、下一步建议，以及可选的中英输入翻译。
- 打包时可尝试内置 CLI runtime，失败或跳过时回退到用户系统 `PATH` 上的 CLI。
- 局域网移动端访问：在「设置 → 局域网移动端访问」里设置密码并启动内置 HTTP 服务，手机 / 平板浏览器打开桌面端给出的 URL 即可使用。**移动端跑的是同一份 React 前端**（包含桌宠 Live2D / 立绘 / 凉宫春日总结 / 结果卡片），通过桥接层把 `invoke`/`listen` 翻译成 HTTP 请求 + 长轮询事件流；窄屏自动切换为顶栏 + 抽屉式侧栏 + 紧凑桌宠的布局。token 缓存在设备本地 30 天免重输；改密或撤销会让所有移动端重新登录。
- 跨设备状态同步：所有 zustand persist store（tabs / settings / profile）通过 `createSharedStorage` 写入 Rust 端的镜像 + 同步落盘到 `lan-storage.json`，**桌面端是唯一权威数据源**。任一端的修改都会广播 `storage://changed` 事件触发其它端 rehydrate；用客户端 ID 防回环。移动端启动时直接从镜像 hydrate，能立刻看到桌面端的项目列表 / 历史会话 / LLM 配置等。

## 当前支持的 Backend

| Backend | 接入方式 | 会话模型 | 说明 |
| --- | --- | --- | --- |
| Claude Code | 长驻 `claude -p` 进程，使用 `stream-json` stdin/stdout | 每个 tab 一个 stream client，用 Claude session id 续接 | 启动参数包含 `--permission-mode acceptEdits`；可配置 model、effort、proxy、binary。 |
| Codex | 共享 `codex app-server`，通过 JSON-RPC 通信 | 全局单 app-server 进程，每个 tab 一个 `thread_id` | 使用 `thread/start`、`thread/resume` 和 `turn/start`；避免多个 Codex 进程抢 `~/.codex/auth.json`。 |
| OpenCode | 每个 tab 启动一个 `opencode serve`，监听 `127.0.0.1`，端口从 `4096` 起分配 | 每个 tab 一个 OpenCode server 进程和 session id | 使用 HTTP 与 SSE；可配置 provider、model、auth mode、proxy、binary。 |

目前 `start_agent` 只实现了这三个 backend。TypeScript 类型里保留了未来 backend 名称，但 Gemini 和 Cursor 还没有真正接入。

## 架构

```text
React / Vite 前端
  - tabs、sidebars、search、stream blocks、result card、pet character
  - Zustand stores，持久化到 localStorage
        |
        | Tauri invoke/listen
        v
Rust 后端
  - ipc::commands / ipc::events
  - agent::manager 负责 lifecycle、routing、stop、finalize
  - llm::* 负责可选的 OpenAI 兼容翻译与总结
        |
        +-- Claude Code stream-json process
        +-- Codex shared app-server JSON-RPC process
        +-- OpenCode per-tab HTTP/SSE serve process
```

运行时以 `run_id` 做路由，`run_id` 与前端 tab id 对齐。同一个 tab 开始新 turn 时，会先停止该 tab 尚未完成的旧 turn；其他 tab 不受影响。

## 安装

### 前置要求

- Node.js 20 或更新版本
- Rust stable toolchain，并包含 `rustfmt`、`clippy`
- Tauri 2 对应平台依赖
- 至少安装并登录一个受支持的 Agent CLI

按需安装 backend CLI：

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
npm install -g opencode-ai
```

然后完成对应登录：

```bash
claude auth login
codex login
opencode auth login
```

应用内的设置面板也能打开 Claude Code、Codex、OpenCode 的登录终端，并在登录后刷新状态或验证连接。

### 本地运行

```bash
git clone https://github.com/sjyinzju/Galcode_island.git
cd Galcode_island
npm install
npm run dev
```

首次进入时选择项目目录和默认 backend，然后在输入气泡中发起任务。`Enter` 发送，`Shift+Enter` 换行。

## LLM 总结与翻译

不配置 LLM API Key 也可以使用应用。此时底层 Agent 的输出会原样展示，结果卡片只提供基础提示。

配置 LLM 后，后端会调用 OpenAI 兼容的 `/chat/completions` 接口，用于：

- 生成凉宫春日风格的完成反馈
- 生成客观的中文结果摘要
- 生成下一步建议按钮
- 在开启“转换为英文输入”后，将中文 prompt 翻成英文再交给 Agent
- 在翻译模式开启且输出不是中文时，将 Agent 输出翻回中文

推荐在应用设置中配置。也可以在启动进程前提供环境变量：

```bash
export LLM_API_KEY="..."
export LLM_BASE_URL="https://api.openai.com/v1"
export LLM_MODEL="gpt-4o-mini"
npm run dev
```

当前预设服务商包括 DeepSeek、OpenAI、Moonshot、通义千问、智谱 GLM、OpenRouter 和自定义 OpenAI 兼容端点。`转换为英文输入` 默认关闭。

## 基本工作流

1. 选择项目目录与 backend。
2. 在主输入气泡中提交任务。
3. 在中栏查看 Agent 的 block 流，包括消息、命令、todo、文件操作、diff 和错误。
4. 点击 command、diff、stderr block，在右栏查看完整内容。
5. 任务完成后，从结果卡片点击建议，或直接输入追问继续同一 tab 的会话。
6. 使用左栏管理活动项目、历史会话和跨项目搜索。

tab 是主要工作单元。每个 tab 都有自己的 backend、项目路径、prompt 历史、native session id、stream blocks 和结果状态。关闭 tab 会写入历史列表，而不是直接丢弃全部上下文。

## 持久化与续接语义

Galcode Island 会持久化 UI 状态，但不会在 Tauri 应用退出后继续保活 CLI 子进程。重启后：

- 已有 tab 会从 localStorage 恢复
- 上次结果和近期 stream blocks 会重新显示
- Claude session id、Codex thread id、OpenCode session id 会作为下一轮 turn 的 resume hint
- 如果上一轮 Agent 已经产出 raw result，但 LLM finalize 阶段被退出打断，应用会尝试重新 finalize

如果应用真正退出时 Agent turn 仍在运行，该 turn 不会从中途继续执行。重新打开后需要发起追问或重试任务。

## 常用脚本

```bash
npm run dev              # 启动 Tauri 桌面开发应用
npm run dev:web          # 仅启动 Vite 前端
npm run typecheck        # TypeScript 类型检查
npm run check:rust       # 在 src-tauri 中执行 cargo check
npm run fmt:rust         # 在 src-tauri 中执行 cargo fmt
npm run lint:rust        # cargo clippy --all-targets -D warnings
npm run prepare:runtime  # 为当前平台暂存 CLI runtime
npm run build            # prepare runtime + build web + tauri build
npm run clean            # 清理 dist、src-tauri/target 和暂存 runtime
```

`npm run dev` 会通过 Tauri 启动 Vite，端口固定为 `1420`。

## 打包

```bash
npm run build
```

Tauri build 前会执行 `scripts/prepare-runtime.mjs`。脚本会把 CLI npm 包安装到临时目录，再尝试把当前平台的二进制复制到：

```text
src-tauri/resources/runtime/<platform>-<arch>/<kind>/<binary>
```

这个步骤是 best effort。某个 backend runtime 如果被跳过或暂存失败，打包产物会回退到用户系统 `PATH` 上查找 `claude`、`codex` 或 `opencode`。

可以按需跳过某个 runtime：

```bash
node scripts/prepare-runtime.mjs --skip-claude
node scripts/prepare-runtime.mjs --skip-codex
node scripts/prepare-runtime.mjs --skip-opencode
```

发布二进制前，请确认被打包 CLI 的再分发许可。

## 安全模型

Galcode Island 当前定位是本地可信开发工具，权限策略偏自动化：

- Claude Code 使用 `--permission-mode acceptEdits` 启动。
- Codex 对命令、权限和文件改动审批做自动放行；文件改动路径会按当前实现做工作目录范围判断。
- OpenCode 会启动 permission auto-approve poller。
- 底层 Agent backend 可能读取、修改、创建文件，也可能执行命令，具体行为取决于对应 CLI。

建议只在可信仓库中使用。开始任务前保持代码已提交，任务后认真审查 diff，不要随意把包含敏感资料或无关个人文件的目录作为项目目录。

设置不是安全密钥库。全局 LLM API Key 会持久化在前端 localStorage 中；OpenCode API Key 会写入 OpenCode 本地 `auth.json`，同时也会保留在设置表单状态里。

## 仓库结构

```text
src/
  App.tsx                      # React 顶层应用、IPC hooks、主布局
  components/                  # UI：侧栏、流式 block、设置、桌宠、气泡
  hooks/                       # Tauri IPC、stream listener、搜索和主题快捷键
  stores/                      # Zustand app/tab/settings/profile/ui stores
  types/                       # 前端 IPC、backend、agent、stream block 类型

src-tauri/
  src/agent/                   # Claude、Codex、OpenCode 接入与运行时状态
  src/ipc/                     # Tauri commands、events、tray
  src/llm/                     # OpenAI 兼容 LLM client 与 prompts
  src/session/                 # session snapshot、状态、清理
  tauri.conf.json              # 窗口、构建、bundle resources 配置

scripts/
  run-tauri.mjs                # 跨平台 Tauri 启动器
  run-cargo.mjs                # 跨平台 cargo wrapper
  prepare-runtime.mjs          # 打包前暂存 CLI runtime

docs/
  architecture.md
  ipc-protocol.md
  character-and-prompts.md
```

`docs/` 下有一些实现说明，但部分内容可能落后于快速迭代的源码。需要精确判断时，以代码为准。

## 常见问题

### 检测不到 backend

先确认 CLI 已安装并登录，然后在设置面板刷新状态。如果 binary 不在 `PATH` 上，可以在 backend preferences 中填写显式路径。

### OpenCode 服务商列表为空

先在设置里启动 OpenCode 服务，再刷新 provider 列表。服务商和模型目录来自运行中的 `opencode serve` API。

### LLM 总结失败

检查 Base URL、API Key 和模型 ID。后端期望服务商兼容 `POST /chat/completions`，模型列表拉取则使用 `GET /models`。

### 打包产物找不到 CLI

运行 `npm run prepare:runtime` 并检查 `src-tauri/resources/runtime`。如果某个 runtime 没有暂存成功，需要让用户全局安装对应 CLI，或在设置里指定 binary 路径。

### Vite 端口被占用

开发模式使用固定端口 `1420` 且启用 strict port。关闭占用该端口的进程后再运行 `npm run dev`。

## 项目状态

当前版本：`0.1.0`。

核心桌面工作流已经实现，包括多 tab 路由、结构化流式输出、会话持久化、backend 设置、历史会话、搜索和打包支持。公开发布前仍建议继续补强交互式权限审批、密钥存储、自动化 UI 测试、素材授权检查，以及 `docs/` 与代码的一致性。

## License

MIT