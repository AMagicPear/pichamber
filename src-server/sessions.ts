import { readdirSync, statSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs"
import { join, basename, resolve, normalize } from "node:path"
import { homedir } from "node:os"

export interface ProjectSessions {
  cwd: string
  name: string
  available: boolean
  sessions: SessionInfo[]
}

export interface SessionInfo {
  id: string
  name?: string
  path: string
  cwd?: string
  createdAt: number
  modifiedAt: number
  messageCount: number
  tokens: number
  cost: number
}

// ── Path helpers (matches Pi's implementation in session-manager.ts) ──

function sessionsRoot(): string {
  if (process.env.PI_CODING_AGENT_DIR) {
    return join(process.env.PI_CODING_AGENT_DIR, "sessions")
  }
  return join(homedir(), ".pi/agent/sessions")
}

/** Encode a cwd into a directory name — exactly how Pi does it. */
function encodeCwd(cwd: string): string {
  const resolved = resolve(normalize(cwd))
  return `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
}

/** Read just the first line of a session file to extract the header. */
function readSessionHeader(filePath: string): Record<string, unknown> | null {
  try {
    const fd = readFileSync(filePath, "utf8")
    const nl = fd.indexOf("\n")
    const firstLine = nl >= 0 ? fd.slice(0, nl) : fd
    if (!firstLine) return null
    const header = JSON.parse(firstLine)
    if (header?.type !== "session" || typeof header.id !== "string") return null
    return header
  } catch {
    return null
  }
}

/** Fast scan: read header line only, count messages by scanning the file. */
function parseSession(filePath: string): SessionInfo | undefined {
  const stat = statSafe(filePath)
  if (!stat || stat.size > 50 * 1024 * 1024) return undefined

  const header = readSessionHeader(filePath)
  if (!header) return undefined

  const id = String(header.id)
  // Pi stores cwd in the session header — this is the canonical source.
  const cwd = typeof header.cwd === "string" ? header.cwd : undefined
  // Name may be on the header itself (older Pi versions).
  let name: string | undefined = typeof header.name === "string" ? header.name : undefined

  // Scan the file for message count, tokens, cost, and name.
  let messageCount = 0
  let tokens = 0
  let cost = 0

  const content = readFileSync(filePath, "utf8")
  const lines = content.split("\n")
  let firstLine = true
  for (const rawLine of lines) {
    if (firstLine) { firstLine = false; continue }
    if (!rawLine.trim()) continue
    let value: any
    try { value = JSON.parse(rawLine) } catch { continue }

    if (name === undefined) {
      name = value.sessionName ?? value.name ?? undefined
    }
    if (value.type === "session_info" && value.name) {
      name = value.name.trim()
    }
    if (value.type === "message" || value.role !== undefined) {
      messageCount += 1
    }
    const usage = value.message?.usage ?? value.usage
    if (usage) {
      tokens += usage.totalTokens ?? usage.total_tokens ?? 0
      cost += usage.cost?.total ?? usage.cost ?? 0
    }
  }

  return {
    id,
    name,
    path: filePath,
    cwd,
    createdAt: Math.floor((stat.ctimeMs || stat.mtimeMs || 0) / 1000),
    modifiedAt: Math.floor((stat.mtimeMs || 0) / 1000),
    messageCount,
    tokens,
    cost,
  }
}

function statSafe(path: string) {
  try { return statSync(path) } catch { return undefined }
}

// ── Public API ────────────────────────────────────────────────────────

/** List all sessions grouped by cwd, scanning every directory under the
 *  Pi sessions root — exactly like Pi's SessionManager.listAll(). */
export function listAllSessionsGrouped(): ProjectSessions[] {
  const root = sessionsRoot()
  if (!existsSync(root)) return []

  const groups = new Map<string, SessionInfo[]>()

  try {
    const entries = readdirSync(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      let files: string[]
      try { files = readdirSync(dir) } catch { continue }
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue
        const session = parseSession(join(dir, file))
        if (!session) continue
        const cwd = session.cwd ?? ""
        if (!groups.has(cwd)) groups.set(cwd, [])
        groups.get(cwd)!.push(session)
      }
    }
  } catch {
    return []
  }

  const projects: ProjectSessions[] = []
  for (const [cwd, sessions] of groups) {
    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
    const available = cwd !== "" && statSafe(cwd)?.isDirectory() === true
    const name = cwd === "" ? "Unknown" : basename(cwd) || cwd
    projects.push({ cwd, name, available, sessions })
  }
  // Sort: available first (by recency), then unavailable (also by recency).
  projects.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1
    return (b.sessions[0]?.modifiedAt ?? 0) - (a.sessions[0]?.modifiedAt ?? 0)
  })
  return projects
}

export function listSessions(): SessionInfo[] {
  const groups = listAllSessionsGrouped()
  return groups.flatMap((g) => g.sessions).sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function deleteSession(sessionPath: string): void {
  const root = sessionsRoot()
  if (!existsSync(root)) throw new Error("Sessions directory unavailable")
  const resolvedRoot = resolve(normalize(root))
  const resolvedTarget = resolve(normalize(sessionPath))
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error("Session path is outside the Pi sessions directory")
  }
  if (!resolvedTarget.endsWith(".jsonl")) {
    throw new Error("Session path must point to a .jsonl file")
  }
  try { unlinkSync(resolvedTarget) } catch (e: any) {
    // ENOENT means the file was already removed (e.g. by Pi compaction
    // or session replacement during switch_session). Treat as success.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new Error(`Unable to delete session: ${e.message ?? e}`)
  }
}

/** Ensure the session directory for a cwd exists — Pi will create the
 *  actual session file when the first message is sent. */
export function ensureSessionDir(cwd: string): string {
  const root = sessionsRoot()
  const dirName = encodeCwd(cwd)
  const dir = join(root, dirName)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}
