import { PtyState } from "./pty.ts"
import { RpcState, type RpcEvent } from "./rpc.ts"
import { listAllSessionsGrouped, listSessions, deleteSession, ensureSessionDir } from "./sessions.ts"
import { workspaceTree, workspaceReadFile } from "./workspace.ts"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"

class AppError extends Error {}

interface AppState {
  rpc: RpcState
  pty: PtyState
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
  }
}

/** Return an empty response with CORS headers. */
function ok(status = 200): Response {
  return new Response(null, { status, headers: corsHeaders() })
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  })
}

function errorResponse(message: string): Response {
  return json({ error: message }, 500)
}

function getQuery(url: URL): Record<string, string> {
  const q: Record<string, string> = {}
  url.searchParams.forEach((v, k) => {
    q[k] = v
  })
  return q
}

async function readJson(req: Request): Promise<any> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

async function handleRpcEventsWs(state: AppState, id: string, server: any, req: Request) {
  if (!state.rpc.hasInstance(id)) {
    return new Response("Instance not found", { status: 404 })
  }
  const success = server.upgrade(req, { data: { type: "rpc-events", id } })
  if (!success) return new Response("WebSocket upgrade failed", { status: 500 })
  return undefined
}

async function handlePtyWs(state: AppState, id: string, server: any, req: Request) {
  const success = server.upgrade(req, { data: { type: "pty", id } })
  if (!success) return new Response("WebSocket upgrade failed", { status: 500 })
  return undefined
}

async function fetchHandler(
  state: AppState,
  req: Request,
  server: any,
): Promise<Response | undefined> {
  const url = new URL(req.url)
  const path = decodeURIComponent(url.pathname)

  // CORS preflight
  if (req.method === "OPTIONS") {
    return ok(204)
  }

  try {
    if (path === "/api/health") {
      return json({ status: "ok", version: "0.2.0" })
    }

    if (path === "/api/sessions" && req.method === "GET") {
      return json(listAllSessionsGrouped())
    }
    if (path === "/api/sessions" && req.method === "DELETE") {
      const q = getQuery(url)
      if (!q.path) return errorResponse("Missing path")
      deleteSession(q.path)
      return ok(204)
    }
    if (path === "/api/sessions/new" && req.method === "GET") {
      const q = getQuery(url)
      if (!q.cwd) return errorResponse("Missing cwd")
      const dir = ensureSessionDir(q.cwd)
      return json({ dir })
    }
    if (path === "/api/sessions/flat" && req.method === "GET") {
      return json(listSessions())
    }

    if (path === "/api/pi/path" && req.method === "GET") {
      const q = getQuery(url)
      return json({ path: state.rpc.findPi(q.path) })
    }

    if (path === "/api/rpc/start" && req.method === "POST") {
      const body = await readJson(req)
      const result = await state.rpc.start(
        { cwd: body.cwd, piPath: body.piPath, env: body.env },
        body.instanceId,
      )
      return json(result)
    }
    const rpcSend = path.match(/^\/api\/rpc\/([^/]+)\/send$/)
    if (rpcSend && req.method === "POST") {
      const body = await readJson(req)
      await state.rpc.send(JSON.stringify(body), rpcSend[1])
      return ok(200)
    }
    const rpcStop = path.match(/^\/api\/rpc\/([^/]+)\/stop$/)
    if (rpcStop && req.method === "POST") {
      await state.rpc.stop(rpcStop[1])
      return ok(200)
    }
    const rpcEvents = path.match(/^\/api\/rpc\/([^/]+)\/events$/)
    if (rpcEvents && req.method === "GET") {
      return handleRpcEventsWs(state, rpcEvents[1], server, req)
    }
    if (path === "/api/dialog/select-directory" && req.method === "POST") {
      try {
        let dir: string | null = null;
        if (process.platform === "darwin") {
          const proc = Bun.spawn([
            "osascript", "-e",
            'POSIX path of (choose folder with prompt "Select project directory")',
          ]);
          const out = await new Response(proc.stdout).text();
          await proc.exited;
          dir = out.trim() || null;
        } else if (process.platform === "linux") {
          const proc = Bun.spawn([
            "zenity", "--file-selection", "--directory",
            "--title=Select project directory",
          ]);
          const out = await new Response(proc.stdout).text();
          await proc.exited;
          dir = out.trim() || null;
        }
        if (!dir) return errorResponse("No directory selected");
        return json({ path: dir });
      } catch (e: any) {
        return errorResponse(e.message ?? String(e));
      }
    }

    if (path === "/api/workspace/tree" && req.method === "GET") {
      const q = getQuery(url)
      return json(workspaceTree(q.root, q.relative, q.depth ? Number(q.depth) : undefined))
    }
    if (path === "/api/workspace/file" && req.method === "GET") {
      const q = getQuery(url)
      return json(workspaceReadFile(q.root, q.relative, q.maxBytes ? Number(q.maxBytes) : undefined))
    }

    if (path === "/api/pty/start" && req.method === "POST") {
      const body = await readJson(req)
      const result = state.pty.start({
        cwd: body.cwd,
        cols: body.cols ?? 80,
        rows: body.rows ?? 24,
        shell: body.shell,
      })
      return json(result)
    }
    const ptyWs = path.match(/^\/api\/pty\/([^/]+)$/)
    if (ptyWs && req.method === "GET") {
      return handlePtyWs(state, ptyWs[1], server, req)
    }

    if (path.startsWith("/api/")) {
      return errorResponse("Not found")
    }

    return serveStatic(path)
  } catch (e: any) {
    const message = e instanceof AppError ? e.message : e?.message ?? String(e)
    return errorResponse(message)
  }
}

function serveStatic(path: string): Response {
  const distDir = findDistDir()
  const rel = path === "/" ? "/index.html" : path
  const filePath = join(distDir, rel)
  if (!filePath.startsWith(distDir)) {
    return errorResponse("Forbidden")
  }
  if (!existsSync(filePath)) {
    const fallback = join(distDir, "index.html")
    if (existsSync(fallback)) {
      return new Response(Bun.file(fallback), { headers: corsHeaders() })
    }
    return new Response("Not found", { status: 404 })
  }
  return new Response(Bun.file(filePath), { headers: corsHeaders() })
}

function findDistDir(): string {
  const candidates = [
    join(process.cwd(), "dist"),
    join(dirname(process.execPath), "dist"),
    join(dirname(process.execPath), "..", "dist"),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return join(process.cwd(), "dist")
}

function onWsOpen(state: AppState, ws: any, data: any): void {
  if (data.type === "rpc-events") {
    const unsub = state.rpc.subscribeEvents(data.id, (event: RpcEvent) => {
      ws.send(JSON.stringify(event))
    })
    ws.data.unsub = unsub
  } else if (data.type === "pty") {
    try {
      const unsub = state.pty.subscribe(data.id, (chunk: string) => {
        ws.send(chunk)
      })
      ws.data.unsub = unsub
    } catch (e: any) {
      ws.close(1011, e.message)
    }
  }
}

function onWsMessage(state: AppState, ws: any, message: any): void {
  const data = ws.data
  if (data?.type !== "pty") return
  const text = typeof message === "string" ? message : message.toString()
  try {
    const ctrl = JSON.parse(text)
    if (ctrl.type === "resize") {
      state.pty.resize(data.id, ctrl.cols, ctrl.rows)
      return
    }
  } catch {}
  state.pty.write(data.id, text)
}

function onWsClose(state: AppState, ws: any): void {
  const data = ws.data
  if (data?.unsub) data.unsub()
  if (data?.type === "pty") state.pty.stop(data.id)
}

export function startServer(): void {
  const port = Number(process.env.PICHAMBER_PORT ?? 1420)
  const state: AppState = {
    rpc: new RpcState(),
    pty: new PtyState(),
  }

  const server = Bun.serve({
    port,
    fetch: (req) => fetchHandler(state, req, server),
    websocket: {
      open: (ws) => onWsOpen(state, ws, ws.data),
      message: (ws, message) => onWsMessage(state, ws, message),
      close: (ws) => onWsClose(state, ws),
    },
  })

  const url = `http://localhost:${port}`
  console.log(`Pichamber v0.2.0 listening on ${url}`)

  if (!process.env.PICHAMBER_DEV) {
    if (process.platform === "darwin") {
      Bun.spawn(["open", url])
    } else if (process.platform === "linux") {
      Bun.spawn(["xdg-open", url])
    }
  }

  const shutdown = async () => {
    console.log("Shutting down...")
    await state.rpc.stopAll()
    state.pty.stopAll()
    server.stop(true)
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

startServer()
