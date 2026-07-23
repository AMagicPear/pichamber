# pichamber × pi 集成:分步实施计划

> 本文档对应从 `packages/server` 出发,接入 `@earendil-works/pi-coding-agent` SDK,实现"web 端多会话切换 + 在每个 session 自己的项目目录里启动 agent"的目标。
>
> 每一小步都是独立可验证的:做完一步 type-check + 一个手工 curl/REPL 验证,再进下一步。

## 0. 总体架构

```
[Vue web]  ──HTTP/WS──▶  [Bun server (Hono)]
                              │
                              ├─ src/index.ts          (HTTP routes, ~30 行)
                              ├─ src/agent.ts          (运行时池)
                              │     Map<sessionId, AgentSession>
                              │     Map<sessionId, sessionFile>   (id → path 索引)
                              │     getSession / createSessionWithCwd / listAllSessions / removeSession
                              └─ src/ws/handler.ts     (Step 5)
                                       │
                                       │ 每个 session 一个 AgentSession
                                       ▼
                                  独立运行的 N 条 session
                                  (各自的 cwd 来自各自的文件头)
```

关键原则:

1. **每个被选中的 session 一个独立 `AgentSession`** —— 同时支持多条对话并行(多 tab / 多用户 / 后台任务)
2. **id 作为对外标识** —— sessionId(UUID)贯穿 HTTP 和 WS,跟 `pi` CLI 一致(`pi` 也允许用户用 id 前缀查找)。path 是存储地址,只在内部用。
3. **`createAgentSession` 而不是 `createAgentSessionRuntime` + factory** —— 因为我们从不切 session,工厂模式(为 `switchSession` 服务)不需要
4. **agent 的 cwd 永远来自 session 文件头** —— `SessionManager.open(path).getCwd()` 传进 `createAgentSession`
5. **不发明新类型**:只用 SDK 已有的 `AgentSession`、`AgentSessionEvent`、`SessionManager`、`SessionInfo`、`createAgentSession`

## 1. HTTP 端点

### 1.1 当前路由(`packages/server/src/index.ts`)

```ts
import { Hono } from "hono";
import { createSessionWithCwd, deleteSession, getSession, listAllSessions } from "./agent";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/sessions", async (c) => {
    const sessions = await listAllSessions();
    return c.json(sessions);
});

app.post("/api/sessions", async (c) => {
    const { cwd } = await c.req.json<{ cwd: string }>();
    const session = await createSessionWithCwd(cwd);
    return c.json({ sessionId: session.sessionId });
});

app.get("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const session = await getSession(id);
    if (!session) return c.json({ error: "session not found" }, 404);
    return c.json(session.sessionManager.getEntries());
});

app.delete("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await deleteSession(id);
    if (!deleted) return c.json({ error: "session not found" }, 404);
    return c.json({ ok: true });
});

export default { port: 3000, fetch: app.fetch };
```

### 1.2 端点总览

| Method | Path | Body | 返回 | 说明 |
|---|---|---|---|---|
| GET | `/api/health` | — | `{ok: true}` | 健康检查 |
| GET | `/api/sessions` | — | `SessionInfo[]` | 列出所有 session。**顺带建 id→path 索引**(见 Step 3) |
| POST | `/api/sessions` | `{cwd: string}` | `{sessionId: string}` | 在 cwd 下创建新 session,返回 id |
| GET | `/api/sessions/:id` | — | `SessionEntry[]` 或 404 | 读 session 历史 entries |
| DELETE | `/api/sessions/:id` | — | `{ok: true}` 或 404 | 删除 session(清理内存 + 删本地 `.jsonl` 文件) |

### 1.3 验证

```bash
bun --filter @pichamber/server type-check
bun --filter @pichamber/server start
```

```bash
# 列 session(取第一个 id)
curl localhost:3000/api/health
FIRST=$(curl -s localhost:3000/api/sessions | jq -r '.[0].id')
curl -s "localhost:3000/api/sessions/$FIRST" | jq '.[0].type'

# 创建
curl -X POST -H 'Content-Type: application/json' \
  -d '{"cwd":"/path/to/project"}' \
  http://localhost:3000/api/sessions
# {"sessionId":"019f8ea9-..."}

# 不存在的 id → 404
curl -s -w "%{http_code}\n" "localhost:3000/api/sessions/00000000-0000-0000-0000-000000000000"
# {"error":"session not found"}404
```

### 1.4 何时才考虑抽出 service 文件

- 同一个调用在多个 route 出现且传参不同
- 需要包一层做缓存/错误处理/日志
- 测试需要 mock
- SDK API 不稳定需要 buffer

## 2. 已确认的后续步骤

Step 1 跑通后,接下来按顺序做:

- **Step 3**: Map<sessionId, AgentSession> 懒加载 + id→path 索引
- **Step 4**: 消息发送端点(`session.prompt`)
- **Step 5**: WebSocket 把 `session.subscribe(...)` 的事件推给前端
- (Step 6 web 端,不属于 server 包)

不再预先设计更多步骤,做一步看一步。

## 3. Map<sessionId, AgentSession> 懒加载

### 3.1 `packages/server/src/agent.ts`

独立文件,不 inline 在 `index.ts`。理由:这一块将来会被 `index.ts` 和 `ws/handler.ts` 都用到,而且有自己的 state(`Map`),抽出来避免污染 HTTP 路由层。

**两个 Map**:
- `activeSessions: Map<sessionId, AgentSession>` —— 活跃 session 池(AgentSession 已创建)
- `sessionFileLookup: Map<sessionId, sessionFile>` —— id → path 索引,供冷启动时按 id 找文件

完整文件:

```ts
import { unlink } from "node:fs/promises";
import {
    type AgentSession,
    createAgentSession,
    getAgentDir,
    type SessionInfo,
    SessionManager,
} from "@earendil-works/pi-coding-agent";

// id → session 文件路径(冷启动后用)
const sessionFileLookup = new Map<string, string>();

// id → 活跃的 AgentSession(已建好)
const activeSessions = new Map<string, AgentSession>();

// 副作用:顺带把 id→path 索引建好
export async function listAllSessions(): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = await SessionManager.listAll();
    sessionFileLookup.clear();
    for (const session of sessions) {
        sessionFileLookup.set(session.id, session.path);
    }
    return sessions;
}

export async function getSession(id: string): Promise<AgentSession | null> {
    const cached = activeSessions.get(id);
    if (cached) return cached;
    let sessionFile = sessionFileLookup.get(id);
    if (!sessionFile) {
        await listAllSessions();   // 刷新索引
        sessionFile = sessionFileLookup.get(id);
    }
    if (!sessionFile) return null;  // 不存在 → null(HTTP 转 404)
    const sessionManager = SessionManager.open(sessionFile);
    const { session } = await createAgentSession({
        cwd: sessionManager.getCwd(),
        agentDir: getAgentDir(),
        sessionManager,
    });
    activeSessions.set(id, session);
    return session;
}

export async function removeSession(id: string) {
    const session = activeSessions.get(id);
    if (!session) return;
    session.dispose();
    activeSessions.delete(id);
}

// 删内存中的 AgentSession + 删本地 jsonl 文件
// 返回 true 表示处理过（存在过）、false 表示这个 id 完全不存在
export async function deleteSession(id: string): Promise<boolean> {
    let file = sessionFileLookup.get(id);
    if (!file) {
        await listAllSessions();  // 刷新索引
        file = sessionFileLookup.get(id);
    }
    const session = activeSessions.get(id);
    if (session) {
        session.dispose();
        activeSessions.delete(id);
    }
    if (!file && !session) return false;
    if (file) {
        try {
            await unlink(file);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        sessionFileLookup.delete(id);
    }
    return true;
}

export async function createSessionWithCwd(cwd: string): Promise<AgentSession> {
    const sessionManager = SessionManager.create(cwd);
    const { session } = await createAgentSession({
        cwd,
        agentDir: getAgentDir(),
        sessionManager,
    });
    activeSessions.set(session.sessionId, session);  // 跟 getSession 一致用 id
    return session;
}
```

### 3.2 为什么 id 作 key 而不是 path

| 维度 | path 作 key | id 作 key |
|---|---|---|
| 用户的友好标识 | path 长得像 `/Users/.../sessions/--cwd--/<timestamp>_<uuid>.jsonl`,没法手打 | id 是 UUID 前缀,可手打(`pi` CLI 支持) |
| inMemory 兼容 | inMemory 没文件,没法用 path 作 key | id 永远有 |
| 跟 pi CLI 对齐 | pi 也用 path 存,但对外暴露 id | ✅ 一致 |
| 反查复杂度 | 传 path 直接 `SessionManager.open(path)` | 需要 id → path 索引 |

我们选 **id 作 key**(外)+ path 作内部索引(内)。

### 3.3 为什么用 `createAgentSession` 而不是 `createAgentSessionRuntime` + factory

`createAgentSessionRuntime(factory, options)` 的工厂模式是为**单 runtime + 切 session** 场景设计的:factory 封装"如何为新 cwd 重建 services",runtime 内部在 `switchSession` / `newSession` 时反复调它。

我们走的是**多 AgentSession + 永不切 session**——每个 session 一个固定 cwd,不需要工厂。所以直接用更简单的 `createAgentSession(options)`,**一步到位**,返回 `{ session, ... }`。

| 我们用的 | 不用的 |
|---|---|
| `createAgentSession` | `createAgentSessionRuntime` |
| `createAgentSessionServices` |  |
| `createAgentSessionFromServices` |  |
| `CreateAgentSessionRuntimeFactory` |  |
| `AgentSession` | `AgentSessionRuntime` |
| `session.dispose()` (sync) | `runtime.dispose()` (async) |
| `runtime.switchSession` / `newSession` / `fork` |  |

### 3.4 关键调用

| 调用 | 作用 |
|---|---|
| `SessionManager.open(sessionFile)` | 打开已有的 session 文件,拿到 manager |
| `sm.getCwd()` | 读 session 文件头里的 cwd,直接返回 `string` |
| `createAgentSession({ cwd, agentDir, sessionManager })` | 创建 `AgentSession`,内部已完成 services 装配 + extensions bind |
| `activeSessions.set(session.sessionId, session)` | 缓存(跟 `getSession` 的 key 一致) |

### 3.5 不发明的东西

- ❌ `RuntimeEntry` / `AgentHandle` — 都是我之前臆想的类型,SDK 没这两个,也不要造
- ❌ 自定义 fan-out `Set<...>` — Step 5 做多 ws 时再说
- ❌ `bindExtensions({})` 单独调用 —— `createAgentSession` 内部已做,不要重复
- ❌ `bindSession()` 重订模式 —— 不需要,从来不切 session
- ❌ 兼容旧的 path API —— 前端还没做,直接换

### 3.6 验证

```bash
bun --filter @pichamber/server type-check
bun --filter @pichamber/server start
```

临时验证(REPL):

```bash
cd packages/server

bun -e "
import { createSessionWithCwd, getSession } from './src/agent';
const s1 = await createSessionWithCwd('/tmp/test-foo-' + Date.now());
console.log('id:', s1.sessionId);
const s2 = await getSession(s1.sessionId);
console.log('cache hit (true):', s2 === s1);
const missing = await getSession('nonexistent-id');
console.log('missing → null:', missing === null);
"
```

⚠️ `createAgentSession` 首次调用会检查 `~/.pi/agent/auth.json` 或环境变量里的 API key。如果没有,会报错。

### 3.7 设计取舍

| 维度 | 决定 | 理由 |
|---|---|---|
| 单 vs 多 AgentSession | **多** | 支持同时多个对话 |
| AgentSession 复用 vs 每次新建 | **复用(懒建)** | 重建 model client 代价高 |
| switchSession vs 独立 AgentSession | **独立** | 切 session 不丢上下文,符合 web 多 tab 场景 |
| AgentSession vs AgentSessionRuntime | **AgentSession** | 不需要 runtime 的 session-replacement 能力 |
| Key: id vs path | **id** | 友好、inMemory 兼容、跟 pi CLI 对齐 |
| 找不到 session 的处理 | **返回 null** | 让 HTTP 层决定 404(而不是 throw 出 500) |
| 删除是否同时删文件 | **是** | 用 `unlink`(`node:fs/promises`),SDK 不提供 |
| 删除是否留空目录 | **是** | `SessionManager.create()` 创建的 session 目录会留下,但影响为 0 |
| 文件位置 | `src/agent.ts` | 独立,被 index 和 ws 都用,有自己的 state |

## 4. 消息发送 HTTP 端点

### 4.1 发送消息

新增路由:

- `POST /api/sessions/:id/messages`,body `{ message: string }`

handler:

1. `const id = c.req.param("id")`
2. `const session = await getSession(id)` —— `null` → 404
3. **`session.prompt(body.message).catch(console.error)`** —— fire-and-forget

**重要**:`prompt()` 的 Promise 等到 retry/queue 全部结束才 resolve。HTTP handler 不能 await(请求会挂死),流式输出靠 Step 5 的 WebSocket 推。

### 4.2 验证

需要至少一个 provider 的 API key 已配置。

```bash
ID=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"cwd":"/path/to/project"}' \
  http://localhost:3000/api/sessions | jq -r '.sessionId')

curl -X POST -H 'Content-Type: application/json' \
  -d '{"message":"hello"}' \
  "http://localhost:3000/api/sessions/$ID/messages"
```

应立刻返回,**不**等 agent 完成。

### 4.3 创建后找不到的边界(已不存)

旧版本用 path 时,POST 后文件还没写盘,`getSession(path)` 会 fallback cwd 到 `process.cwd()`。

现在用 id 后,新建 session 立刻进 `activeSessions`(`createSessionWithCwd` 用 `session.sessionId` 作 key 写入),**没有任何 fallback 窗口**。这个边界消失了。

## 5. WebSocket 流式事件(Hono)

用 Hono 的 `hono/bun` 适配器,不用额外装包(参考 https://hono.dev/docs/helpers/websocket)。

### 5.1 `packages/server/src/ws/handler.ts`

```ts
import { upgradeWebSocket, type WSContext } from "hono/bun";
import { Hono } from "hono";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { getSession } from "../agent";

type WsCtx = WSContext<unknown>;
const subs = new Map<string, { session: AgentSession; sockets: Set<WsCtx> }>();
const wsOwn = new WeakMap<WsCtx, Set<string>>();

function attachListener(sessionId: string, session: AgentSession) {
    if (subs.has(sessionId)) return;
    const sockets = new Set<WsCtx>();
    session.subscribe((evt: AgentSessionEvent) => {
        for (const ws of sockets) ws.send(JSON.stringify({ type: "event", sessionId, event: evt }));
    });
    subs.set(sessionId, { session, sockets });
}

export function wsRoutes(): Hono {
    const app = new Hono();
    app.get("/ws", upgradeWebSocket(() => ({
        onOpen: (_evt, ws) => wsOwn.set(ws, new Set()),
        onMessage: async (evt, ws) => {
            const msg = JSON.parse(evt.data as string);
            if (msg.type === "subscribe") {
                const session = await getSession(msg.sessionId);
                if (!session) {
                    ws.send(JSON.stringify({ type: "error", error: `session ${msg.sessionId} not found` }));
                    return;
                }
                attachListener(msg.sessionId, session);
                subs.get(msg.sessionId)!.sockets.add(ws);
                wsOwn.get(ws)!.add(msg.sessionId);
                ws.send(JSON.stringify({ type: "subscribed", sessionId: msg.sessionId }));
            } else if (msg.type === "unsubscribe") {
                const entry = subs.get(msg.sessionId);
                if (entry) entry.sockets.delete(ws);
                wsOwn.get(ws)?.delete(msg.sessionId);
            } else if (msg.type === "prompt") {
                const session = await getSession(msg.sessionId);
                if (!session) {
                    ws.send(JSON.stringify({ type: "error", error: `session ${msg.sessionId} not found` }));
                    return;
                }
                session.prompt(msg.message).catch((err) => ws.send(JSON.stringify({ type: "error", error: String(err) })));
            }
        },
        onClose: (_evt, ws) => {
            const owned = wsOwn.get(ws);
            if (!owned) return;
            for (const id of owned) subs.get(id)?.sockets.delete(ws);
            wsOwn.delete(ws);
        },
    })));
    return app;
}
```

### 5.2 `packages/server/src/index.ts` 接入

```ts
import { wsRoutes } from "./ws/handler";
import { websocket } from "hono/bun";
const app = new Hono();
// ... 现有路由 ...
app.route("/", wsRoutes());
export default { port: 3000, fetch: app.fetch, websocket };
```

### 5.3 协议

**客户端 → 服务端**:

| 消息 | 含义 |
|---|---|
| `{type: "subscribe", sessionId}` | 订阅该 session;服务端 `getSession(id)`,挂 SDK listener,加 ws 到 fan-out |
| `{type: "unsubscribe", sessionId}` | 取消订阅 |
| `{type: "prompt", sessionId, message}` | 在指定 session 上发消息(等价于 HTTP POST) |

**服务端 → 客户端**:

| 消息 | 含义 |
|---|---|
| `{type: "subscribed", sessionId}` | subscribe 回执 |
| `{type: "event", sessionId, event}` | `event` 是 `AgentSessionEvent` |
| `{type: "error", error}` | 出错(如 sessionId 不存在) |

### 5.4 关键设计点

- **同一个 session 只挂一次 SDK listener** —— `subs.has(sessionId)` 幂等保护
- **fan-out 在 SDK listener 内部**:listener 读 `subs.get(id).sockets`,推到该 session 的所有 ws
- **`WeakMap<ws, Set<id>>`** —— close 时反向清理
- **`getSession` 返回 null 时主动报错**给客户端,不静默丢消息
- **不主动 `removeSession`** —— session 跟 session 文件一一对应,生命周期跟文件同寿

### 5.5 验证

```bash
websocat ws://localhost:3000/ws
> {"type":"subscribe","sessionId":"019f8cb5-..."}
< {"type":"subscribed","sessionId":"019f8cb5-..."}
> {"type":"prompt","sessionId":"019f8cb5-...","message":"hi"}
< {"type":"event","sessionId":"...","event":{"type":"message_update",...}}
< {"type":"event","sessionId":"...","event":{"type":"agent_end",...}}
```

## 6. Web 端集成(本次范围之外,只列大纲)

新建/修改文件:

- `packages/web/src/stores/sessions.ts` — Pinia store
  - state: `sessions: SessionInfo[]`、`currentId: string | null`、`messages: SessionEntry[]`、`isStreaming: boolean`
  - actions: `fetchSessions()`、`selectSession(id)`、`sendMessage(text)`、`onWsEvent(evt)`
- `packages/web/src/api/client.ts` — fetch 调 `/api/sessions` 系列
- `packages/web/src/api/ws.ts` — WebSocket 连接 + 重连 + 订阅管理
- `packages/web/src/components/SessionList.vue` — 按 `cwd` 分组展示 sessions
- `packages/web/src/components/ChatView.vue` — 消息列表 + 输入框,消费 ws 推送的 `text_delta`

不做的事:

- 没有鉴权 / 多用户隔离
- 没有扩展 UI 子协议 —— SDK 直调不需要这些

## 7. 不在本次范围 / 后续再说

- 服务端如何"知道"用户的项目目录在哪:目前假设 `~/.pi/agent/sessions/` 已经被各种方式填好
- 跨 server 实例的 session 共享
- pi 的扩展系统本身

## 8. 引用

- SDK 总览:`@earendil-works/pi-coding-agent/docs/sdk.md`
- 本设计**不抄**官方 `examples/sdk/13-session-runtime.ts` 的工厂模式 —— 那是单 runtime + `switchSession` 场景,我们的多 session 场景不需要
- 跟 `pi` CLI 的 `resolveSessionPath` 一致:id 是友好标识,path 是存储地址
- RPC 协议备查(本次不直接用,只是知识):`@earendil-works/pi-coding-agent/docs/rpc.md` / `docs/rpc.md`