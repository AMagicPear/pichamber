import type {
  ConversationTranscriptMessage,
  LiveConversationState,
  ModelDescriptor,
  ServerMessage,
  ThinkingState,
} from "@pichamber/shared";

export type WsHandle = {
  send: (message: unknown) => void;
  close: () => void;
};

/** Connection lifecycle status — distilled from server messages + transport events. */
export type WsStatus =
  | {
      type: "ready";
      messages?: ConversationTranscriptMessage[];
      live?: LiveConversationState;
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
    }
  | { type: "messages"; messages: ConversationTranscriptMessage[] }
  | { type: "live"; live: LiveConversationState }
  | { type: "model_state"; model?: ModelDescriptor; availableModels: ModelDescriptor[]; thinking: ThinkingState }
  | { type: "error"; error: string }
  | { type: "closed"; code?: number; reason?: string };

export const wsUrl = (path: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}//${location.host}${normalized}`;
};

/**
 * Shared socket plumbing: transport error → `error` status, close → `closed`
 * status. `onMessage` receives each text frame; `encode` serializes what
 * `send()` passes (JSON for the session protocol, raw stdin for the PTY).
 */
const createSocket = (
  url: string,
  onMessage: (data: string) => void,
  onStatus?: (status: WsStatus) => void,
  encode: (message: unknown) => string = (message) => JSON.stringify(message),
  onOpen?: () => void,
): WsHandle => {
  const socket = new WebSocket(url);
  socket.onopen = () => onOpen?.();
  socket.onmessage = (event) => onMessage(String(event.data));
  socket.onclose = (event) => onStatus?.({ type: "closed", code: event.code, reason: event.reason });
  socket.onerror = () => onStatus?.({ type: "error", error: "Transport error" });
  return {
    send: (message) => socket.send(encode(message)),
    close: () => socket.close(),
  };
};

/** Connect to the Pi AgentSession JSON protocol. */
export const connectSessionWs = (
  sessionId: string,
  onMessage: (status: Extract<WsStatus, { type: "messages" | "live" }>) => void,
  onStatus?: (status: WsStatus) => void,
): WsHandle =>
  createSocket(wsUrl(`/ws/${sessionId}`), (data) => {
    const msg = JSON.parse(data) as ServerMessage;
    if (msg.type === "messages") {
      onMessage({ type: "messages", messages: msg.messages });
    } else if (msg.type === "live") {
      onMessage({ type: "live", live: msg.live });
    } else if (msg.type === "model_state") {
      onStatus?.({
        type: "model_state",
        model: msg.model,
        availableModels: msg.availableModels,
        thinking: msg.thinking,
      });
    } else if (msg.type === "ready") {
      onStatus?.({
        type: "ready",
        messages: msg.messages,
        live: msg.live,
        model: msg.model,
        availableModels: msg.availableModels,
        thinking: msg.thinking,
      });
    } else if (msg.type === "error") {
      onStatus?.({ type: "error", error: String(msg.error ?? "unknown error") });
    }
  }, onStatus);

/** Connect to a PTY terminal WebSocket. Output is raw text; input accepts
 *  strings (stdin keystrokes) or objects (JSON control frames like resize).
 *  The server sends nothing on connect, so the transport opening IS the
 *  ready signal. */
export const connectPtyWs = (
  ptyId: string,
  onData: (data: string) => void,
  onStatus?: (status: WsStatus) => void,
): WsHandle =>
  createSocket(
    wsUrl(`/ws/pty/${encodeURIComponent(ptyId)}`),
    onData,
    onStatus,
    (message) => (typeof message === "string" ? message : JSON.stringify(message)),
    () => onStatus?.({ type: "ready" }),
  );
