import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { LiveConversationState, LiveToolExecution, ServerMessage } from "@pichamber/shared";
import type { ServerWebSocket } from "bun";
import { toMessage } from "./error";
import { getEffectiveModelDescriptor, getThinkingState } from "./models";
import { deactivateSession, getConversationMessages, getSession } from "./session";
import type { SessionWsData, WsHandler } from "./index";

type BunWS = ServerWebSocket<SessionWsData>;

type SessionChannel = {
  sockets: Set<BunWS>;
  unsubscribe: () => void;
  live: {
    pendingUserMessages: LiveConversationState["pendingUserMessages"];
    streamingMessage?: LiveConversationState["streamingMessage"];
    toolExecutions: Map<string, LiveToolExecution>;
  };
};

// sessionId → one shared SDK listener plus all subscribed sockets.
const channelsBySession = new Map<string, SessionChannel>();

const liveState = (channel: SessionChannel): LiveConversationState => ({
  pendingUserMessages: channel.live.pendingUserMessages,
  streamingMessage: channel.live.streamingMessage,
  toolExecutions: [...channel.live.toolExecutions.values()],
});

/** Re-snapshot the active model + available models + thinking state and
 *  push it to every client watching this session. Errors are logged so a
 *  single transient provider hiccup can't kill the channel. */
const broadcastModelState = (
  session: AgentSession,
  broadcast: (msg: ServerMessage) => void,
  sessionIdForLog: string,
) => {
  getEffectiveModelDescriptor(session)
    .then(({ model, availableModels }) => {
      broadcast({
        type: "model_state",
        model,
        availableModels,
        thinking: getThinkingState(session),
      });
    })
    .catch((error) => {
      console.error("Failed to snapshot model state", sessionIdForLog, error);
    });
};

const attachListener = (sessionId: string, session: AgentSession): SessionChannel => {
  const existing = channelsBySession.get(sessionId);
  if (existing) return existing;

  const channel: SessionChannel = {
    sockets: new Set(),
    unsubscribe: () => undefined,
    live: { pendingUserMessages: [], toolExecutions: new Map() },
  };
  const broadcast = (msg: ServerMessage) => {
    const payload = JSON.stringify(msg);
    for (const bunWS of channel.sockets) {
      if (bunWS.readyState === 1) bunWS.send(payload);
    }
  };
  let modelStateBroadcastQueued = false;
  const queueModelStateBroadcast = () => {
    if (modelStateBroadcastQueued) return;
    modelStateBroadcastQueued = true;
    queueMicrotask(() => {
      modelStateBroadcastQueued = false;
      broadcastModelState(session, broadcast, sessionId);
    });
  };
  channel.unsubscribe = session.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "user") {
      channel.live.pendingUserMessages.push(event.message);
      broadcast({ type: "live", live: liveState(channel) });
    } else if (event.type === "message_start" && event.message.role === "assistant") {
      channel.live.streamingMessage = event.message;
      broadcast({ type: "live", live: liveState(channel) });
    } else if (event.type === "message_update" && event.message.role === "assistant") {
      channel.live.streamingMessage = event.message;
      broadcast({ type: "live", live: liveState(channel) });
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      channel.live.streamingMessage = event.message;
      broadcast({ type: "live", live: liveState(channel) });
    } else if (event.type === "tool_execution_start") {
      channel.live.toolExecutions.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        running: true,
      });
      broadcast({ type: "live", live: liveState(channel) });
    } else if (event.type === "tool_execution_update") {
      const tool = channel.live.toolExecutions.get(event.toolCallId);
      if (tool) {
        tool.result = event.partialResult;
        broadcast({ type: "live", live: liveState(channel) });
      }
    } else if (event.type === "tool_execution_end") {
      const tool = channel.live.toolExecutions.get(event.toolCallId);
      if (tool) {
        tool.result = event.result;
        tool.isError = event.isError;
        tool.running = false;
        broadcast({ type: "live", live: liveState(channel) });
      }
    } else if (event.type === "entry_appended") {
      if (
        event.entry.type === "model_change" ||
        event.entry.type === "thinking_level_change"
      ) {
        // Pi emits several synchronous events for one model switch. Queue
        // one snapshot for the whole mutation instead of broadcasting the
        // same model inventory once per entry.
        queueModelStateBroadcast();
      }
      if (event.entry.type !== "model_change" && event.entry.type !== "thinking_level_change") {
        broadcast({ type: "messages", messages: getConversationMessages(session) });
      }
    } else if (event.type === "agent_settled") {
      channel.live.pendingUserMessages = [];
      channel.live.streamingMessage = undefined;
      channel.live.toolExecutions.clear();
      broadcast({ type: "messages", messages: getConversationMessages(session) });
      broadcast({ type: "live", live: liveState(channel) });
    } else if (event.type === "thinking_level_changed") {
      // Keep the client in sync when Pi clamps a requested level without a
      // separate entry visible to the transcript.
      queueModelStateBroadcast();
    }
  });
  channelsBySession.set(sessionId, channel);
  return channel;
};

const detachListener = (sessionId: string, ws: BunWS) => {
  const channel = channelsBySession.get(sessionId);
  if (!channel) return;
  channel.sockets.delete(ws);
  if (channel.sockets.size !== 0) return;
  channel.unsubscribe();
  channelsBySession.delete(sessionId);
  deactivateSession(sessionId).catch((error) => {
    console.error("Failed to deactivate session", sessionId, error);
  });
};

export const closeSessionSockets = (sessionId: string) => {
  const channel = channelsBySession.get(sessionId);
  if (!channel) return;
  channel.unsubscribe();
  channelsBySession.delete(sessionId);
  for (const ws of channel.sockets) {
    ws.data.closed = true;
    ws.data.attached = false;
    if (ws.readyState === 1) ws.close(1000, "Session deleted");
  }
  channel.sockets.clear();
};

const sendError = (ws: BunWS, error: string) => {
  const msg: ServerMessage = { type: "error", error };
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};

export const sessionWsHandler: WsHandler = {
  async open(ws) {
    const bunWS = ws as BunWS;
    const { sessionId } = bunWS.data;
    bunWS.data.closed = false;
    const session = await getSession(sessionId);
    if (bunWS.data.closed) {
      if (!channelsBySession.has(sessionId)) {
        deactivateSession(sessionId).catch((error) => {
          console.error("Failed to deactivate session", sessionId, error);
        });
      }
      return;
    }
    if (!session) {
      sendError(bunWS, "session not found");
      bunWS.close();
      return;
    }
    const channel = attachListener(sessionId, session);
    channel.sockets.add(bunWS);
    bunWS.data.attached = true;
    let snapshot: Awaited<ReturnType<typeof getEffectiveModelDescriptor>>;
    try {
      snapshot = await getEffectiveModelDescriptor(session);
    } catch (error) {
      console.error("Failed to load model snapshot", sessionId, error);
      snapshot = { model: undefined, availableModels: [] };
    }
    const msg: ServerMessage = {
      type: "ready",
      sessionId,
      messages: getConversationMessages(session),
      live: liveState(channel),
      model: snapshot.model,
      availableModels: snapshot.availableModels,
      thinking: getThinkingState(session),
    };
    bunWS.send(JSON.stringify(msg));
  },
  async message(ws, message) {
    const bunWS = ws as BunWS;
    if (bunWS.data.closed || !bunWS.data.attached) return;

    let msg: unknown;
    try {
      msg = JSON.parse(typeof message === "string" ? message : message.toString());
    } catch {
      sendError(bunWS, "invalid JSON message");
      return;
    }
    if (!msg || typeof msg !== "object") {
      sendError(bunWS, "message must be an object");
      return;
    }
    const input = msg as { type?: unknown; [k: string]: unknown };
    const { sessionId } = bunWS.data;
    const session = await getSession(sessionId);
    if (bunWS.data.closed) return;
    if (!session) {
      sendError(bunWS, "session not found");
      return;
    }
    switch (input.type) {
      case "prompt": {
        if (typeof input.message !== "string") {
          sendError(bunWS, "prompt message must be a string");
          return;
        }
        // Fire-and-forget: prompt() runs until the retry/queue drains; events
        // flow back via subscribe().
        session
          .prompt(input.message)
          .catch((err: unknown) =>
            sendError(bunWS, toMessage(err)),
          );
        return;
      }
      case "set_model": {
        if (typeof input.provider !== "string" || typeof input.modelId !== "string") {
          sendError(bunWS, "set_model requires provider+modelId strings");
          return;
        }
        const target = session.modelRuntime.getModel(input.provider, input.modelId);
        if (!target) {
          sendError(bunWS, `Unknown model: ${input.provider}/${input.modelId}`);
          return;
        }
        try {
          await session.setModel(target);
        } catch (err) {
          sendError(bunWS, toMessage(err));
        }
        return;
      }
      case "set_thinking_level": {
        if (typeof input.level !== "string") {
          sendError(bunWS, "set_thinking_level requires a level string");
          return;
        }
        // setThinkingLevel is a synchronous clamp; it just throws
        // (TypeError) for unsupported levels — which we surface as an
        // error frame.
        try {
          session.setThinkingLevel(input.level as Parameters<typeof session.setThinkingLevel>[0]);
        } catch (err) {
          sendError(bunWS, toMessage(err));
        }
        return;
      }
      default:
        // Unknown message types are ignored so clients can probe
        // forward-compat features without the server crashing them.
        return;
    }
  },
  close(ws) {
    const bunWS = ws as BunWS;
    const { sessionId } = bunWS.data;
    bunWS.data.closed = true;
    if (!bunWS.data.attached) return;
    bunWS.data.attached = false;
    detachListener(sessionId, bunWS);
  },
};
