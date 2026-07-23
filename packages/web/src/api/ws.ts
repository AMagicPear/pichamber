// WS 客户端 — 浏览器连 ws://host/ws/:sessionId（经 Vite proxy）
// 返回一个简单 handle：send/close；回调拿到 SDK AgentSessionEvent

export type SessionEvent = {
  type: string
  [k: string]: unknown
}

export type WsHandle = {
  send: (msg: unknown) => void
  close: () => void
}

export function connectWs(
  sessionId: string,
  onEvent: (event: SessionEvent) => void,
): WsHandle {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${proto}//${location.host}/ws/${sessionId}`)

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'event') onEvent(msg.event as SessionEvent)
    else console.log('[ws msg]', msg)
  }
  ws.onopen = () => console.log('[ws open]', sessionId)
  ws.onclose = () => console.log('[ws close]', sessionId)
  ws.onerror = (e) => console.error('[ws error]', sessionId, e)

  return {
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => ws.close(),
  }
}