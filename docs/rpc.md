# pi RPC 模式参考

> 本文档整理自 `pi-coding-agent` 官方文档 `docs/rpc.md`,作为本仓库查阅与对接时的功能清单与协议速查。
>
> 官方来源: <https://github.com/earendil-works/pi-coding-agent/blob/main/docs/rpc.md>

RPC 模式让 pi 通过 stdin/stdout 上的 JSON 协议实现无头(headless)运行,适合把 pi 嵌入到其它应用、IDE 或自定义 UI 中。

> **Node/TypeScript 提示**: 如果你在写 Node 应用,优先直接用 `@earendil-works/pi-coding-agent` 暴露的 `AgentSession`,而不是起子进程。子进程版的 TS 客户端可以参考 `src/modes/rpc/rpc-client.ts`。

---

## 1. 启动

```bash
pi --mode rpc [options]
```

常用选项:

| 选项 | 说明 |
|---|---|
| `--provider <name>` | LLM 提供方(anthropic / openai / google 等) |
| `--model <pattern>` | 模型 pattern 或 ID,支持 `provider/id`,可选 `:<thinking>` 后缀 |
| `--name <name>` / `-n <name>` | 启动时设置会话显示名 |
| `--no-session` | 禁用会话持久化 |
| `--session-dir <path>` | 自定义会话存储目录 |

---

## 2. 协议基础

- **命令 (Commands)**: 写入 stdin 的 JSON 对象,每行一条
- **响应 (Responses)**: 写到 stdout 的 JSON 对象,`type: "response"`,表示命令成功/失败
- **事件 (Events)**: stdout 上持续流式输出的 JSON 行,不含 `id`
- 所有命令都支持可选的 `id` 字段;填了之后对应的响应会回带同一个 `id`,用于请求/响应关联

### 2.1 Framing (行分隔)

RPC 模式使用严格的 **JSONL** 语义,**只允许 LF (`\n`) 作为记录分隔符**。客户端:

- 只按 `\n` 切分记录
- 接受可选的 `\r\n` 输入,剥掉行尾 `\r`
- 不要用通用行读取器去匹配 Unicode 分隔符

> ⚠️ Node 的 `readline` **不符合本协议**,因为它还会按 `U+2028` / `U+2029` 切分,而这两个字符在 JSON 字符串里是合法的。

---

## 3. 命令清单

### 3.1 提示与消息发送

| 命令 | 用途 |
|---|---|
| `prompt` | 发送用户提示给 agent |
| `steer` | agent 正在运行时,排队一条转向消息(在当前工具调用结束后、下一次 LLM 调用前投递) |
| `follow_up` | 排队一条后续消息,agent 完全结束后才投递 |
| `abort` | 中止当前 agent 操作 |

#### 共享字段

- `message`: 文本内容
- `images` (可选): `ImageContent` 数组,`{"type":"image","data":"<base64>","mimeType":"image/png"}`

#### `prompt` 流式行为

- 智能体正在流式输出时,必须指定 `streamingBehavior`,否则返回错误:
  - `"steer"`: 排队为转向消息,在当前助手轮工具调用结束后投递
  - `"followUp"`: 排队为后续消息,等 agent 完全停下才投递
- 扩展命令(以 `/xxx` 开头)即使在流式中也会**立即执行**,不需 `streamingBehavior`
- skill 命令(`/skill:xxx`)和 prompt 模板(`/template`)在发送/排队前会**先展开**

#### 响应语义

```json
{"id":"req-1","type":"response","command":"prompt","success":true}
```

- `success: true` 表示"被接受 / 排队 / 立即处理"
- `success: false` 表示"在被接受前就被拒绝"
- 被接受之后的失败(网络错误、工具执行失败等)通过正常的事件流上报,**不会**对同一个 `id` 发第二条 `response`

#### `steer` / `follow_up`

- 都允许 `images`
- skill 命令和 prompt 模板会展开
- 扩展命令不允许(用 `prompt` 替代)
- 投递节奏由对应的 `set_steering_mode` / `set_follow_up_mode` 控制

#### `abort`

立刻中止当前 agent 操作,常和 `SIGINT` 配合做"取消键"。

---

### 3.2 会话生命周期

| 命令 | 用途 |
|---|---|
| `new_session` | 开新会话,可选关联 `parentSession` |
| `get_state` | 取当前会话状态 |
| `get_messages` | 取当前会话所有消息 |
| `get_session_stats` | 取会话统计(token/费用/上下文窗口) |
| `get_last_assistant_text` | 取最后一条助手文本 |
| `get_commands` | 列出所有可用的扩展命令 / prompt 模板 / skill |
| `set_session_name` | 设置会话显示名 |
| `switch_session` | 切换到指定 session 文件 |
| `export_html` | 把当前会话导出成 HTML |

`get_state.data` 字段:

```json
{
  "model": {...},
  "thinkingLevel": "medium",
  "isStreaming": false,
  "isCompacting": false,
  "steeringMode": "all",
  "followUpMode": "one-at-a-time",
  "sessionFile": "/path/to/session.jsonl",
  "sessionId": "abc123",
  "sessionName": "my-feature-work",
  "autoCompactionEnabled": true,
  "messageCount": 5,
  "pendingMessageCount": 0
}
```

`get_session_stats.data` 关键字段:

- `tokens`: 会话累计 token(input / output / cacheRead / cacheWrite / total)
- `cost`: 会话累计费用
- `contextUsage`: 当前上下文窗口使用量(可能为 `null`,比如压缩后到下一次助手响应之前)

`get_commands.data.commands[]` 每条带:

- `name`: 命令名(用 `/name` 调用)
- `description`: 描述
- `source`: `"extension"` / `"prompt"` / `"skill"`
- `location` (可选): `"user"` / `"project"` / `"path"`
- `path` (可选): 源文件绝对路径

> 内置 TUI 命令(`/settings`、`/hotkeys` 等)**不在** `get_commands` 结果里——它们只在交互模式生效,通过 `prompt` 发送也不会执行。

---

### 3.3 Fork / Clone / 会话树

| 命令 | 用途 |
|---|---|
| `fork` | 从当前 active 分支上某条历史用户消息**重新分叉** |
| `clone` | 把当前 active 分支**整体克隆**为一个新 session |
| `get_fork_messages` | 列出当前分支上可 fork 的用户消息 |
| `get_entries` | 按追加顺序取所有条目,支持 `since` 游标增量拉取 |
| `get_tree` | 取整棵会话树 |

`fork` / `clone` / `switch_session` / `new_session` 都可以被对应的扩展事件处理器取消(分别为 `session_before_fork` / `session_before_switch`),响应里通过 `data.cancelled` 反映。

`get_entries` 用稳定的 entry id 当游标,适合客户端断线重连后做增量同步;响应里还有 `leafId`,一轮就能判断活动分支是否前进。

---

### 3.4 模型与思考

| 命令 | 用途 |
|---|---|
| `set_model` | 切到指定 `provider` + `modelId` |
| `cycle_model` | 循环切换到下一个可用模型(只有一个模型时 `data` 为 `null`) |
| `get_available_models` | 列出所有已配置的模型 |

| 命令 | 用途 |
|---|---|
| `set_thinking_level` | 设置思考级别 |
| `cycle_thinking_level` | 循环切换思考级别 |
| `get_available_thinking_levels` | 列出当前模型支持的思考级别 |

可用思考级别:`"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`

- `"xhigh"` / `"max"` 只在该模型支持时才暴露
- 不支持推理的模型 `get_available_thinking_levels` 返回 `["off"]`

---

### 3.5 队列模式

| 命令 | 用途 |
|---|---|
| `set_steering_mode` | 控制 `steer` 消息的投递节奏 |
| `set_follow_up_mode` | 控制 `follow_up` 消息的投递节奏 |

可选值:

- `"all"`: 当前助手轮工具调用结束后**全部投递**
- `"one-at-a-time"` (默认): 每完成一个助手轮**投递一条**

---

### 3.6 压缩 (Compaction)

| 命令 | 用途 |
|---|---|
| `compact` | 手动压缩会话上下文,可带 `customInstructions` |
| `set_auto_compaction` | 开关自动压缩 |

`compact` 响应里的关键字段:

- `summary`: 生成的摘要
- `firstKeptEntryId`: 保留的第一条 entry id
- `tokensBefore` / `estimatedTokensAfter`: 压缩前/后的 token(后者是启发式估计,不是 provider 精确数)
- `usage`: 生成摘要的 LLM 调用 usage

`compaction_*` 事件的 `reason` 字段:`"manual"` / `"threshold"` / `"overflow"`。`"overflow"` 成功后会带 `willRetry: true` 自动重试原 prompt。

---

### 3.7 重试 (Retry)

| 命令 | 用途 |
|---|---|
| `set_auto_retry` | 开关瞬时错误(overloaded / rate limit / 5xx)的自动重试 |
| `abort_retry` | 取消正在进行的重试(取消延迟并停止) |

配套事件 `auto_retry_start` / `auto_retry_end`,以及用于压缩或分支摘要时瞬时错误重试的 `summarization_retry_scheduled` / `summarization_retry_attempt_start` / `summarization_retry_finished`。

---

### 3.8 Bash

| 命令 | 用途 |
|---|---|
| `bash` | 立即执行 shell 命令并把输出加到会话上下文 |
| `abort_bash` | 中止正在运行的 bash 命令 |

`bash` 响应:

```json
{
  "type": "response",
  "command": "bash",
  "success": true,
  "data": {
    "output": "...",
    "exitCode": 0,
    "cancelled": false,
    "truncated": false
  }
}
```

输出过长被截断时会带 `fullOutputPath`。

> bash 输出**不会**立即进 LLM 上下文,而是在**下一次 `prompt`** 时,把内部累积的 `BashExecutionMessage` 序列化成 user 消息一起带上:
>
> ````
> Ran `ls -la`
> ```
> total 48
> drwxr-xr-x ...
> ```
> ````
>
> 因此可以一次性连发多个 `bash` 再发 `prompt`,所有结果会一起进上下文。

---

## 4. 事件清单

事件只从 stdout 流式输出,**没有 `id`**。

### 4.1 生命周期与消息

| 事件 | 触发时机 |
|---|---|
| `agent_start` | agent 开始处理一个 prompt |
| `agent_end` | 一次低层级 agent run 结束(若 `willRetry: true` 会自动重试) |
| `agent_settled` | 整个 session 级 run 完全 settle,不再有自动重试 / 压缩重试 / 排队续接 |
| `turn_start` | 新一轮开始 |
| `turn_end` | 一轮结束(含 assistant message + tool results) |
| `message_start` | 一条消息开始 |
| `message_update` | 流式增量(含 `assistantMessageEvent` 增量) |
| `message_end` | 一条消息结束 |

### 4.2 流式增量 (`message_update.assistantMessageEvent.type`)

| 类型 | 含义 |
|---|---|
| `start` | 消息生成开始 |
| `text_start` / `text_delta` / `text_end` | 文本块 |
| `thinking_start` / `thinking_delta` / `thinking_end` | 思考块 |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | 工具调用块(`toolcall_end` 含完整 `toolCall`) |
| `done` | 消息完成(`reason`: `"stop"` / `"length"` / `"toolUse"`) |
| `error` | 错误(`reason`: `"aborted"` / `"error"`) |

### 4.3 工具执行

| 事件 | 触发时机 |
|---|---|
| `tool_execution_start` | 工具开始执行,带 `toolCallId` |
| `tool_execution_update` | 执行中的流式进度(例如 bash 增量输出) |
| `tool_execution_end` | 执行结束,带 `result` 与 `isError` |

> `partialResult` 字段是**累积值**而不是 delta,客户端每来一条直接替换展示即可,无需自己拼接。

### 4.4 队列与压缩

| 事件 | 触发时机 |
|---|---|
| `queue_update` | steering/follow-up 队列变化,带 `steering[]` / `followUp[]` |
| `compaction_start` / `compaction_end` | 压缩开始/结束 |

### 4.5 重试

| 事件 | 触发时机 |
|---|---|
| `auto_retry_start` / `auto_retry_end` | 助手轮瞬时错误自动重试 |
| `summarization_retry_scheduled` / `summarization_retry_attempt_start` / `summarization_retry_finished` | 压缩或分支摘要的瞬时错误重试 |

### 4.6 扩展错误

`extension_error` 在扩展抛异常时触发,带 `extensionPath` / `event` / `error`。

---

## 5. 扩展 UI 协议

扩展可以通过 `ctx.ui.*` 请求用户交互。RPC 模式下,这层交互被翻译成 stdout 上的 `extension_ui_request` 和 stdin 上的 `extension_ui_response`。

- **对话框方法** (`select` / `confirm` / `input` / `editor`): 发请求 → 阻塞等响应
- **即发即弃** (`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`): 发请求,不期待响应
- 对话框如果带 `timeout`,agent 端会在超时后自动用默认值 resolve,客户端无需自己计时

### 5.1 请求 (stdout)

所有请求形如 `{"type":"extension_ui_request","id":"...","method":"..."}`。

| 方法 | 关键字段 | 说明 |
|---|---|---|
| `select` | `title`, `options[]`, `timeout`? | 列表选择;响应里给 `value` |
| `confirm` | `title`, `message`, `timeout`? | 确认;响应里给 `confirmed` |
| `input` | `title`, `placeholder`? | 文本输入;响应里给 `value` |
| `editor` | `title`, `prefill`? | 多行编辑;响应里给 `value` |
| `notify` | `message`, `notifyType`? | 通知,`info`/`warning`/`error` |
| `setStatus` | `statusKey`, `statusText`? | 状态条;`undefined` 表示清除 |
| `setWidget` | `widgetKey`, `widgetLines[]`, `widgetPlacement`? | 部件,`aboveEditor`/`belowEditor`;`undefined` 表示清除 |
| `setTitle` | `title` | 终端标题 |
| `set_editor_text` | `text` | 编辑器文本 |

### 5.2 响应 (stdin)

只在对话框方法上发送,`id` 必须匹配:

```json
{"type":"extension_ui_response","id":"uuid","value":"Allow"}
{"type":"extension_ui_response","id":"uuid","confirmed":true}
{"type":"extension_ui_response","id":"uuid","cancelled":true}
```

`cancelled: true` 对应扩展侧收到 `undefined`(`select`/`input`/`editor`)或 `false`(`confirm`)。

### 5.3 不支持 / 降级的方法

下列 `ExtensionUIContext` 方法在 RPC 模式下不可用或被降级,因为它们需要直接 TUI 访问:

| 方法 | 行为 |
|---|---|
| `custom()` | 返回 `undefined` |
| `setWorkingMessage` / `setWorkingIndicator` / `setFooter` / `setHeader` / `setEditorComponent` / `setToolsExpanded` | no-op |
| `getEditorText` | 返回 `""` |
| `getToolsExpanded` | 返回 `false` |
| `pasteToEditor` | 委托给 `setEditorText`(不处理 paste/collapse) |
| `getAllThemes` | 返回 `[]` |
| `getTheme` | 返回 `undefined` |
| `setTheme` | 返回 `{ success: false, error: "..." }` |

> 在 RPC 模式下 `ctx.mode === "rpc"`,`ctx.hasUI === true`(`select` 等对话框可用)。涉及真正终端的能力(如 `custom()`)时,用 `ctx.mode === "tui"` 显式守卫。

---

## 6. 错误处理

命令失败:

```json
{"type":"response","command":"set_model","success":false,"error":"Model not found: invalid/model"}
```

JSON 解析失败:

```json
{"type":"response","command":"parse","success":false,"error":"Failed to parse command: Unexpected token..."}
```

---

## 7. 类型参考

### 7.1 Model

```json
{
  "id": "claude-sonnet-4-20250514",
  "name": "Claude Sonnet 4",
  "api": "anthropic-messages",
  "provider": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "reasoning": true,
  "input": ["text", "image"],
  "contextWindow": 200000,
  "maxTokens": 16384,
  "cost": {"input": 3.0, "output": 15.0, "cacheRead": 0.3, "cacheWrite": 3.75}
}
```

### 7.2 消息

- **UserMessage**: `role: "user"`,`content` 可以是字符串或 `TextContent`/`ImageContent` 块数组,带 `attachments`
- **AssistantMessage**: `role: "assistant"`,`content[]` 含 `text` / `thinking` / `toolCall`;`stopReason` ∈ `"stop" | "length" | "toolUse" | "error" | "aborted"`
- **ToolResultMessage**: `role: "toolResult"`,含 `toolCallId` / `toolName` / `content[]` / `isError`,可选 `usage`
- **BashExecutionMessage** (`role: "bashExecution"`): 由 `bash` RPC 命令生成,**不是** LLM tool call,事件流里看不到它——只在内部状态里累积,下一次 `prompt` 时一并进 LLM 上下文
- **Attachment**: `id` / `type` / `fileName` / `mimeType` / `size` / `content` (base64) / `extractedText`? / `preview`?

---

## 8. 客户端示例

### 8.1 Python (最小骨架)

```python
import subprocess, json

proc = subprocess.Popen(
    ["pi", "--mode", "rpc", "--no-session"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
)

def send(cmd):
    proc.stdin.write(json.dumps(cmd) + "\n"); proc.stdin.flush()

send({"type": "prompt", "message": "Hello!"})

for line in proc.stdout:
    ev = json.loads(line)
    if ev.get("type") == "message_update":
        delta = ev.get("assistantMessageEvent", {})
        if delta.get("type") == "text_delta":
            print(delta["delta"], end="", flush=True)
    if ev.get("type") == "agent_end":
        print(); break
```

### 8.2 Node.js (交互式)

完整示例见官方 `test/rpc-example.ts`,或 `src/modes/rpc/rpc-client.ts`。完整带扩展 UI 的演示见 `examples/rpc-extension-ui.ts` + `examples/extensions/rpc-demo.ts`。

核心点是用自己的 LF-only JSONL 解析器(不要用 `readline`),并允许可选 `\r\n`:

```javascript
const { spawn } = require("child_process");
const { StringDecoder } = require("string_decoder");

const agent = spawn("pi", ["--mode", "rpc", "--no-session"]);

function attachJsonlReader(stream, onLine) {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
        buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
        while (true) {
            const i = buffer.indexOf("\n");
            if (i === -1) break;
            let line = buffer.slice(0, i);
            buffer = buffer.slice(i + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            onLine(line);
        }
    });
    stream.on("end", () => {
        buffer += decoder.end();
        if (buffer.length) {
            const last = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
            onLine(last);
        }
    });
}

attachJsonlReader(agent.stdout, (line) => {
    const ev = JSON.parse(line);
    if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(ev.assistantMessageEvent.delta);
    }
});

agent.stdin.write(JSON.stringify({ type: "prompt", message: "Hello" }) + "\n");

process.on("SIGINT", () => {
    agent.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
});
```

---

## 9. 功能总览 (一图速查)

```
pi --mode rpc
├─ 命令 (stdin, JSONL)
│  ├─ 消息 / 队列
│  │  ├─ prompt / steer / follow_up / abort
│  ├─ 会话
│  │  ├─ new_session / switch_session / fork / clone
│  │  ├─ get_state / get_messages / get_entries / get_tree
│  │  ├─ get_session_stats / get_last_assistant_text / get_fork_messages
│  │  ├─ get_commands / set_session_name / export_html
│  ├─ 模型 / 思考
│  │  ├─ set_model / cycle_model / get_available_models
│  │  └─ set_thinking_level / cycle_thinking_level / get_available_thinking_levels
│  ├─ 队列模式
│  │  ├─ set_steering_mode / set_follow_up_mode
│  ├─ 压缩
│  │  ├─ compact / set_auto_compaction
│  ├─ 重试
│  │  ├─ set_auto_retry / abort_retry
│  └─ Bash
│     └─ bash / abort_bash
│
├─ 响应 (stdout, type:"response", 带 id)
│
├─ 事件 (stdout, 不带 id)
│  ├─ agent_start / agent_end / agent_settled
│  ├─ turn_start / turn_end
│  ├─ message_start / message_update / message_end
│  ├─ tool_execution_start/update/end
│  ├─ queue_update / compaction_start/end
│  ├─ auto_retry_start/end
│  └─ summarization_retry_* / extension_error
│
└─ 扩展 UI (基于上面的 stdout/stdin 子协议)
   ├─ 对话框(需响应): select / confirm / input / editor
   └─ 即发即弃: notify / setStatus / setWidget / setTitle / set_editor_text
```

---

## 10. 参考资料

- 官方 RPC 文档: <https://github.com/earendil-works/pi-coding-agent/blob/main/docs/rpc.md>
- JSON Event Stream 模式(更轻量,只流事件不交互): `docs/json.md`
- SDK 编程接口(不依赖 stdin/stdout): `docs/sdk.md`
- 扩展开发指南: `docs/extensions.md`