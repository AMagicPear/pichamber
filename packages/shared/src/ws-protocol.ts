/** JSON messages the server sends to session WebSocket clients. */
export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "error"; error: string }
  | { type: "event"; event: unknown };

/** JSON messages the client sends to the session WebSocket server. */
export type ClientMessage = { type: "prompt"; message: string };
