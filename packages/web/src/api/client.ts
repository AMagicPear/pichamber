// REST 客户端 — 所有请求通过 Vite proxy 转发到 server:3000
const BASE = '/api'

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`)
  return data as T
}

export const listSessions = () =>
  fetch(`${BASE}/sessions`).then((r) => jsonOrThrow<unknown[]>(r))

export const createSession = (cwd: string) =>
  fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  }).then((r) => jsonOrThrow<{ sessionId: string }>(r))

export const getEntries = (sessionId: string) =>
  fetch(`${BASE}/sessions/${sessionId}`).then((r) => jsonOrThrow<unknown[]>(r))

export const deleteSession = (sessionId: string) =>
  fetch(`${BASE}/sessions/${sessionId}`, { method: 'DELETE' }).then((r) =>
    jsonOrThrow<{ ok: true }>(r),
  )