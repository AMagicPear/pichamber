# 实时通信方案分析

> 状态:分析稿,待决策。讨论"前端怎么跟服务端多个活跃会话同时交互"。

---

## 1. 一句话结论

**每个会话一个 WebSocket 连接**(`ws://.../ws/:sessionId`)。最简单,够用,不用发明协议。

---

## 2. 问题是什么(说人话)

服务端跑着 N 个活跃会话(每个会话是 1 次 LLM 对话,有自己的 cwd / 文件)。
前端(Vue 网页)需要同时跟其中任意多个会话交互,具体场景:

- 用户开 3 个 tab,每个 tab 看一个会话,分别打字、收事件
- 用户在一个 tab 里同时跟 2 个会话对话(少见)
- 用户刷新页面,tab 重连,事件不能丢

每个会话会产生**流式事件**:LLM 一边打字一边推 token、工具调用结果、错误、重试状态等。前端要"实时看到"这些事件,不能靠轮询。

**核心需求:**
1. 往指定会话发消息("你帮我看看这个文件")
2. 接收指定会话的事件(token 增量、工具调用结束…)
3. 同时多个会话独立工作,互不干扰

---

## 3. 先把术语讲清楚

### 3.1 协议(protocol)

"协议"就是"消息长什么样"。JSON 字段约定。

举个最朴素的协议(假设我们要重新发明轮子):

- 客户端 → 服务端: `{ "type": "prompt", "message": "你好" }`
- 服务端 → 客户端: `{ "type": "event", "event": {...} }`

`type` 字段是约定 —— "看到 `type: prompt` 就知道是发消息,看到 `type: event` 就知道是事件流"。这就是协议。

### 3.2 fan-out(一对多推送)

**一个事件,推给多个接收方。**

举例:
- 服务端有 1 个 AgentSession(1 次 LLM 对话)
- 用户在浏览器开了 2 个 tab 都连这个 session
- LLM 输出 token → 服务端要**同时**推给 2 个 ws
- 这就是 fan-out(1 份数据 → 多份发送)

我们当前 SDK 接口 `session.subscribe(listener)` 里的 listener 就是 fan-out 的位置:一个 listener 收一份事件,然后在 callback 里把事件转给多个 ws。

### 3.3 多路复用(multiplexing)

**一个连接里跑多路独立会话。**

举例:
- 1 个 ws 连接
- 这个 ws 同时承载 session A、session B、session C 的事件
- ws 上来回的消息要带 sessionId:"这条是 A 的 / 这条是 B 的"

反面是 "每路会话一个独立连接"。

> 现实类比:微信里你有 10 个好友在聊,微信是 1 个连接(多路复用),而不是 10 个连接。
> Slack 网页版是 1 个 ws 推所有频道的消息。

---

## 4. 三种方案

### 4.1 方案 A:**每会话一连接**(推荐)

URL: `ws://host/ws/:sessionId`

```
tab1 (session=A) ──ws──┐
                       │
tab2 (session=B) ──ws──┼── server
                       │
tab3 (session=A) ──ws──┘  (注意:tab1 和 tab3 是同一会话)
```

**协议(2 条消息就够):**

客户端 → 服务端:
```json
{ "type": "prompt", "message": "看看 src 目录" }
```

服务端 → 客户端:
```json
{ "type": "ready",   "sessionId": "019f..." }
{ "type": "event",   "event": { ...SDK AgentSessionEvent... } }
{ "type": "error",   "error": "ENOENT..." }
```

**优点:**
- URL 自带路由,没有歧义:每个 ws 100% 属于一个 session
- 协议极简,2 条客户端消息 + 3 条服务端消息,完了
- 不需要 subscribe/unsubscribe —— 连接建立 = 订阅
- 不需要 fan-out(同一 session 多 tab 才需要,见下面)
- 关掉 tab 关掉 ws,生命周期自然
- 前端用现成 `WebSocket` API,不需要状态机

**缺点:**
- 多 tab 时连接数 = tab 数(浏览器轻松扛 100 个 ws,问题不大)
- 协议不"通用",将来想加 abort / steer / set_model 之类命令时要扩字段

**fan-out 在哪发生?**
只在"同一 session 多 tab"时。服务端:
```
sessionId → { session: AgentSession, sockets: Set<WSContext> }
```
SDK listener 一份,内部遍历 `sockets` 推送。这是唯一需要 Set/Map 的地方。

### 4.2 方案 B:一连接多路复用

URL: `ws://host/ws`

```
tab1 ──ws──┐
           │
tab2 ──ws──┼── server (路由:消息里的 sessionId 决定归属)
           │
tab3 ──ws──┘
```

**协议(多 2 条):**

客户端 → 服务端:
```json
{ "type": "subscribe",   "sessionId": "019f..." }
{ "type": "unsubscribe", "sessionId": "019f..." }
{ "type": "prompt",      "sessionId": "019f...", "message": "..." }
```

服务端 → 客户端:
```json
{ "type": "subscribed", "sessionId": "019f..." }
{ "type": "event",      "sessionId": "019f...", "event": {...} }
{ "type": "error",      "error": "..." }
```

**优点:**
- 一个 tab 一个连接(不论 tab 看几个会话)
- Slack / 微信 / Discord 都这么做
- 协议显式,前端状态清晰("我现在订阅了哪几个 session")

**缺点:**
- 协议更复杂:5+1 条消息类型
- 服务端需要 `Map<sessionId, sockets>` + `WeakMap<ws, Set<sessionId>>` 反向索引(关 ws 时清理)
- 前端要状态机:发 subscribe 等回执、追踪已订阅列表
- 多会话订阅顺序、并发订阅、错误恢复都要考虑

**这就是当前 `ws.ts` 实现的方案。**

### 4.3 方案 C:抄 pi RPC 模式(`pi --mode rpc`)

URL: `ws://host/rpc`(或 stdio,但浏览器用不上)

**协议:** 完全抄 pi 的 RPC 命令(`docs/rpc.md`)
- 客户端: `{ "type": "prompt", "id": "req-1", "message": "..." }`
- 服务端响应: `{ "type": "response", "id": "req-1", "command": "prompt", "success": true }`
- 服务端事件流(主动推): `{ "type": "agent_start" }`、`{ "type": "message_update", ... }`...

**优点:**
- 跟 pi 生态一致,熟悉
- 命令集丰富(prompt / steer / follow_up / abort / get_state / set_model …)
- 复用我们写的 `docs/rpc.md`(其实就是从 pi 那边抄的)

**缺点:**
- **每个进程一个 session**(这是 pi RPC 的设计前提)。要 N 个会话就要 N 个进程 / N 个 ws 子连接
- 协议里所有事件都是匿名的("哪个 session 的?"需要外层标记)
- 我们没法直接抄 —— 浏览器没法 fork 进程,要么换成本地用 child_process 跑 `pi --mode rpc` 然后 proxy(架构完全变了)
- 重

### 4.4 方案 D:SSE

URL: `GET /api/sessions/:id/events`(SSE)+ `POST /api/sessions/:id/messages`(普通 HTTP)

**协议:**
- POST 触发 prompt
- SSE 推 `data: {...AgentSessionEvent...}\n\n`

**优点:**
- 标准 HTTP,不用 ws upgrade
- 浏览器 EventSource 自带重连
- 每会话一连接,跟方案 A 一样简单

**缺点:**
- 单向(只能 server → client),prompt 必须走 POST
- 比 ws 略慢(每个事件一行 HTTP,header 重复)
- 浏览器对同一域名 SSE 连接数有限制(默认 6,HTTP/1.1)

---

## 5. 推荐:方案 A(每会话一连接)

### 5.1 为什么

| 维度 | 方案 A | 方案 B | 方案 C | 方案 D |
|---|---|---|---|---|
| 协议复杂度 | ★ 极简 | ★★★ 中 | ★★★★ 重 | ★★ 简单 |
| 服务端实现 | 30 行 | 80 行 + 反向索引 | 需另起进程 | 30 行 |
| 前端使用 | `new WebSocket(...)` | 状态机 | RPC 客户端 | EventSource |
| 多会话支持 | 每 tab 1 ws | 1 ws 多 session | 需 N 进程 | 每 tab 1 SSE |
| 跟 SDK 契合 | ✅ 直接 | ⚠️ 多一层 | ❌ 架构不兼容 | ✅ |
| 浏览器友好 | ✅ | ✅ | ⚠️ | ⚠️ (6 连接限制) |

方案 A 最直接,代码量最少,跟 SDK 的 `session.subscribe()` 接口 1:1 映射(每个 ws 一个 listener,Set 解决多 tab fan-out)。

### 5.2 协议定义(方案 A 完整规格)

**连接 URL:** `ws://host:3000/ws/:sessionId`

**连接建立时:**
- 服务端拿 `sessionId` 去 `getSession(sessionId)`:
  - 成功 → 监听 SDK 事件,推给 ws,发 `{type: "ready"}`
  - 失败 → 发 `{type: "error", error: "session not found"}`,关 ws

**客户端 → 服务端(只有 1 种):**
```json
{ "type": "prompt", "message": "看一下 src" }
```
服务端:从 ws 拿到 sessionId → 调 `session.prompt(msg.message)`(fire-and-forget)。

**服务端 → 客户端(3 种):**

```json
{ "type": "ready",  "sessionId": "019f..." }
```
连接建立成功后,客户端可以开始发 prompt。

```json
{ "type": "event",  "event": { ...AgentSessionEvent... } }
```
SDK 推过来的事件原样转发。`event` 字段是 SDK 的 `AgentSessionEvent` discriminated union,前端按 `event.type` 分支处理(`message_update` / `tool_execution_end` / `agent_end` 等)。

```json
{ "type": "error",  "error": "..." }
```
各种错误:session not found / prompt 失败 / SDK 内部错。

**关闭:**
- 客户端关 ws:服务端从 `sockets` Set 移除,如果是该 session 最后一个 ws,目前不动 AgentSession(继续缓存)
- 服务端想要踢人:`ws.close()`

### 5.3 服务端代码骨架

```ts
// packages/server/src/ws.ts
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ServerWebSocket } from "bun";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { deactivateSession, getSession } from "./session";

// hono/bun 每次事件都 new WSContext 包装器,Set 必须用底层 Bun WS (ws.raw) 做身份
type BunWS = ServerWebSocket<unknown>;

const socketsBySession = new Map<string, Set<BunWS>>();

const attachListener = (sessionId: string, session: AgentSession) => {
  if (socketsBySession.has(sessionId)) return;
  const sockets = new Set<BunWS>();
  session.subscribe((event: AgentSessionEvent) => {
    const payload = JSON.stringify({ type: "event", event });
    for (const bunWS of sockets) bunWS.send(payload);
  });
  socketsBySession.set(sessionId, sockets);
};

// Y 策略:最后一个 ws 关就 dispose
const detachListener = (sessionId: string, ws: WSContext) => {
  const sockets = socketsBySession.get(sessionId);
  if (!sockets) return;
  const raw = ws.raw as BunWS | undefined;
  if (raw) sockets.delete(raw);
  if (sockets.size !== 0) return;
  socketsBySession.delete(sessionId);
  deactivateSession(sessionId);
};

export const wsHandler = upgradeWebSocket(async (c) => {
  const sessionId = c.req.param("id")!;
  return {
    onOpen: async (_evt, ws) => {
      const session = await getSession(sessionId);
      if (!session) {
        ws.send(JSON.stringify({ type: "error", error: "session not found" }));
        ws.close();
        return;
      }
      attachListener(sessionId, session);
      const raw = ws.raw as BunWS | undefined;
      if (raw) socketsBySession.get(sessionId)!.add(raw);
      ws.send(JSON.stringify({ type: "ready", sessionId }));
    },
    onMessage: async (evt, ws) => {
      const msg = JSON.parse(evt.data as string);
      if (msg.type !== "prompt") return;
      const session = await getSession(sessionId);
      if (!session) {
        ws.send(JSON.stringify({ type: "error", error: "session not found" }));
        return;
      }
      session.prompt(msg.message).catch((err) =>
        ws.send(JSON.stringify({ type: "error", error: String(err) })),
      );
    },
    onClose: (_evt, ws) => {
      detachListener(sessionId, ws);
    },
  };
});

// packages/server/src/index.ts
import { websocket } from "hono/bun";
app.get("/ws/:id", wsHandler);
export default {
  port: 3000,
  fetch: app.fetch,
  websocket, // hono/bun 适配器,负责 open/close/message
};
```

### 5.4 前端使用示例

```ts
// packages/web/src/composables/useSession.ts (示意)
const ws = new WebSocket(`ws://localhost:3000/ws/${sessionId}`);

ws.onopen = () => console.log("ready");
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "event") {
    if (msg.event.type === "message_update") {
      // 流式 token:更新 UI
      appendToken(msg.event.assistantMessageEvent);
    } else if (msg.event.type === "tool_execution_end") {
      // 工具调用结束:刷新 entries
    } else if (msg.event.type === "agent_end") {
      // 本轮 LLM 跑完
    }
  } else if (msg.type === "error") {
    showError(msg.error);
  }
};

function send(text: string) {
  ws.send(JSON.stringify({ type: "prompt", message: text }));
}
```

每个 tab 一个 `WebSocket` 实例,组件销毁时 `ws.close()`。

### 5.5 跟 `activeSessions` 的关系

| 时刻 | 行为 |
|---|---|
| 服务端启动 | `activeSessions` 是空 Map |
| 首次 `getSession(id)` | 加载 jsonl + 创建 AgentSession,缓存到 Map |
| 后续 `getSession(id)`(同 id) | 直接返回 Map 里的 |
| WS connect | 调 `getSession(id)`,可能触发首次加载 |
| 最后一个 WS close | dispose + 从 Map 删除(Y 策略) |
| 多 tab 中间一个 WS close | 只从 Set 移除 ws,不 dispose |
| `DELETE /api/sessions/:id` | dispose + 从 Map 删除 + 删文件 |

注意:刚 POST 未 prompt 的会话不会被落盘,dispose 后 GET 返回 404(见 7.3)。

---

## 6. 跟现状 `ws.ts` 的差异

| | 现状(B 方案) | 推荐(A 方案) |
|---|---|---|
| URL | `/ws` | `/ws/:id` |
| 客户端消息类型 | 3 (`subscribe`/`unsubscribe`/`prompt`) | 1 (`prompt`) |
| 服务端消息类型 | 4 (`subscribed`/`event`/`error` + close) | 3 (`ready`/`event`/`error`) |
| 服务端数据结构 | `Map<id, {session, sockets}>` + `WeakMap<ws, Set<id>>` | `Map<id, Set<ws>>`(单层) |
| 反向索引 | 需要(清理时遍历 owned sessionId) | 不需要 |
| 协议解析 | 分支 3 路 | 分支 1 路 |
| 前端状态 | "我订阅了哪些 sessionId" 列表 | 不用,URL 自带 |
| 适合场景 | 多会话混在一个 tab | 每 tab 一会话(主流) |

**代码量:** A 方案约 40 行,B 方案约 70 行。A 砍掉了一半的状态管理。

---

## 7. 决策记录

### 7.1 WS 协议与 fan-out ✅

采用方案 A(每会话一连接)。已实现 `packages/server/src/ws.ts` + `packages/server/src/index.ts`。

### 7.2 Dispose 时机 ✅

**Y 策略:最后一个 ws 关闭就 dispose AgentSession。**

- `wsBySession: Map<sessionId, Set<BunWS>>` 跟踪每个 session 的活跃 ws
- `onClose` → 从 Set 移除 ws → 如果 Set 为空 → dispose session + 从 activeSessions 删除
- 下次 `getSession(id)` 会从磁盘重新加载(如果有 prompt 过,文件已落盘)

### 7.3 pi 的“会话落盘”机制(坑点)

SDK 的 `SessionManager._persist()` 要等到 **首条 assistant 消息** 才会写 JSONL 文件:
- POST → 创建内存 session(分配了 `sessionFile` 路径,**文件不存在**)
- 收到 user 消息 + assistant 响应后才落盘
- 所以 “刚 POST 还没 prompt”的会话 → dispose 后 GET /api/sessions/:id 会 404

**不为之加保质逻辑** — 这不是 bug,是 pi 的设计。“没发过消息的会话”= 不存在。前端如果意外丢失 sessionId,重新 POST 即可。

### 7.4 WSContext 包装器坑点(坑点)

`hono/bun` 在每次 ws 事件(open/close/message)都会 `new WSContext(...)`,返回不同的包装器对象。如果在 `Set` 里存 `WSContext`,add 和 delete 会命中不同对象 → **永远删除不了**。

修复:存底层 `BunWS`(`ws.raw`),不受包装器重建影响。

### 7.5 还保留为 “暂不做” 的事项

- `prompt-ack` 回执:SDK 事件流已包含 `agent_end` + error,多一条协议是冗余
- `abort` / `steer` 命令:等真有需求再加
- ws reconnect 重发历史:需要时前端调 GET /api/sessions/:id

---

## 8. 实现状态

- `packages/server/src/ws.ts` ✅ 方案 A + Y dispose + ws.raw 身份
- `packages/server/src/index.ts` ✅ 导入 `websocket` 适配器 + `app.get("/ws/:id", wsHandler)`
- `packages/server/src/session.ts` ✅ `deactivateSession(id)` 供 ws.ts 调用
- 端到端测试:单 ws / 多 ws fan-out / 不存在会话 / dispose 后 GET / prompt 后 GET 均通过