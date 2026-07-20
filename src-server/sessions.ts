import { readdirSync, statSync, readFileSync, existsSync, realpathSync, unlinkSync } from "node:fs"
import { join, dirname, basename, resolve } from "node:path"
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

function sessionsRoot(): string {
  if (process.env.PI_CODING_AGENT_DIR) {
    return join(process.env.PI_CODING_AGENT_DIR, "sessions")
  }
  return join(homedir(), ".pi/agent/sessions")
}

function decodeDirToCwd(dirName: string): string | undefined {
  const core = dirName.replace(/^-+|-+$/g, "")
  if (!core) return undefined
  const tokens = core.split("-")
  if (tokens.length === 0) return undefined

  function walk(index: number, current: string): string | undefined {
    if (index === tokens.length) {
      return statSafe(current)?.isDirectory() ? current : undefined
    }
    const separated = `${current}/${tokens[index]}`
    const joined = `${current}-${tokens[index]}`
    if (existsSync(separated)) {
      const found = walk(index + 1, separated)
      if (found) return found
    }
    const found = walk(index + 1, joined)
    if (found) return found
    return walk(index + 1, separated)
  }

  return walk(1, `/${tokens[0]}`)
}

function statSafe(path: string) {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}

function timestamp(meta: ReturnType<typeof statSync>, created: boolean): number {
  const value = created
    ? meta.ctimeMs || meta.mtimeMs
    : meta.mtimeMs
  return Math.floor((value || 0) / 1000)
}

function parseSession(path: string): SessionInfo | undefined {
  const meta = statSafe(path)
  if (!meta) return undefined
  if (meta.size > 50 * 1024 * 1024) return undefined

  let id = basename(path, ".jsonl")
  let name: string | undefined
  let cwd: string | undefined
  let messageCount = 0
  let tokens = 0
  let cost = 0
  let hasSessionHeader = false

  const content = readFileSync(path, "utf8")
  for (const rawLine of content.split("\n")) {
    if (!rawLine.trim()) continue
    let value: any
    try {
      value = JSON.parse(rawLine)
    } catch {
      continue
    }
    if (value.type === "session") {
      hasSessionHeader = true
      if (value.id) id = value.id
    }
    if (name === undefined) {
      name = value.name ?? value.sessionName ?? undefined
    }
    if (cwd === undefined) {
      cwd = value.cwd ?? undefined
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

  if (cwd === undefined) {
    const parent = basename(dirname(path))
    cwd = decodeDirToCwd(parent)
  }

  // Skip files that are not actual Pi sessions (e.g. aborted/partial writes
  // that never recorded a session header or any message). Pi itself rejects
  // these, so listing them only leads to a failed open click.
  if (!hasSessionHeader && messageCount === 0) {
    return undefined
  }

  return {
    id,
    name,
    path,
    cwd,
    createdAt: timestamp(meta, true),
    modifiedAt: timestamp(meta, false),
    messageCount,
    tokens,
    cost,
  }
}

function scanSessions(): SessionInfo[] {
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  const results: SessionInfo[] = []
  const stack = [root]
  let depth = 0
  while (stack.length && depth < 4) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      const stat = statSafe(full)
      if (!stat) continue
      if (stat.isDirectory()) {
        stack.push(full)
      } else if (entry.endsWith(".jsonl")) {
        const parsed = parseSession(full)
        if (parsed) results.push(parsed)
      }
    }
    depth += 1
  }
  return results
}

export function listAllSessionsGrouped(): ProjectSessions[] {
  const sessions = scanSessions()
  sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)

  const groups = new Map<string, SessionInfo[]>()
  for (const session of sessions) {
    const cwd = session.cwd ?? ""
    if (!groups.has(cwd)) groups.set(cwd, [])
    groups.get(cwd)!.push(session)
  }

  const projects: ProjectSessions[] = []
  for (const [cwd, groupSessions] of groups) {
    groupSessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
    const available = cwd !== "" && statSafe(cwd)?.isDirectory() === true
    const name =
      cwd === ""
        ? "Unknown"
        : basename(cwd) || cwd
    projects.push({ cwd, name, available, sessions: groupSessions })
  }
  projects.sort(
    (a, b) =>
      (b.sessions[0]?.modifiedAt ?? 0) - (a.sessions[0]?.modifiedAt ?? 0),
  )
  return projects
}

export function listSessions(): SessionInfo[] {
  const sessions = scanSessions()
  sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return sessions
}

export function deleteSession(sessionPath: string): void {
  const root = sessionsRoot()
  if (!existsSync(root)) throw new Error("Sessions directory unavailable")
  const resolvedRoot = resolveSafe(root)
  const resolvedTarget = resolveSafe(sessionPath)
  if (!resolvedTarget || !resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error("Session path is outside the Pi sessions directory")
  }
  if (!resolvedTarget.endsWith(".jsonl")) {
    throw new Error("Session path must point to a .jsonl file")
  }
  try {
    unlinkSync(resolvedTarget)
  } catch (e: any) {
    throw new Error(`Unable to delete session: ${e.message ?? e}`)
  }
}

function resolveSafe(p: string): string | undefined {
  try {
    return realpathSync(p)
  } catch {
    try {
      return resolve(p)
    } catch {
      return undefined
    }
  }
}
