import { readdirSync, statSync, readFileSync, realpathSync } from "node:fs"
import { join, relative, sep, isAbsolute } from "node:path"

const MAX_TREE_ENTRIES = 5_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export interface TreeEntry {
  name: string
  path: string
  kind: "file" | "directory"
  size?: number
  children?: TreeEntry[]
}

export interface FileContent {
  path: string
  content: string
  size: number
  truncated: boolean
}

function validateRelative(rel: string): string {
  if (rel.includes("\0")) throw new Error("Path contains a NUL byte")
  if (isAbsolute(rel)) throw new Error("Path must stay inside the project")
  const parts = rel.split(sep).filter((p) => p && p !== ".")
  for (const part of parts) {
    if (part === "..") throw new Error("Path must stay inside the project")
  }
  return rel
}

function safeTarget(root: string, rel: string): { root: string; target: string } {
  const canonicalRoot = realpathSync(root)
  if (!statSync(canonicalRoot).isDirectory())
    throw new Error("Project root is not a directory")
  const validated = validateRelative(rel)
  const target = realpathSync(join(canonicalRoot, validated))
  if (!target.startsWith(canonicalRoot))
    throw new Error("Path escapes the project root")
  return { root: canonicalRoot, target }
}

const IGNORED = new Set([".git", "node_modules", "target", "dist"])

function buildTree(
  root: string,
  directory: string,
  depth: number,
  count: { value: number },
): TreeEntry[] {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch (e: any) {
    throw new Error(`Unable to read directory: ${e.message ?? e}`)
  }
  entries.sort((a, b) => {
    const aStat = statSafe(join(directory, a))
    const bStat = statSafe(join(directory, b))
    const aFile = aStat ? !aStat.isDirectory() : true
    const bFile = bStat ? !bStat.isDirectory() : true
    if (aFile !== bFile) return aFile ? 1 : -1
    return a.toLowerCase().localeCompare(b.toLowerCase())
  })

  const result: TreeEntry[] = []
  for (const name of entries) {
    if (count.value >= MAX_TREE_ENTRIES) break
    if (IGNORED.has(name)) continue
    const full = join(directory, name)
    const meta = statSafe(full)
    if (!meta) continue
    if (meta.isSymbolicLink?.()) continue
    count.value += 1
    const rel = relative(root, full)
    if (meta.isDirectory()) {
      const children = depth > 0 ? buildTree(root, full, depth - 1, count) : undefined
      result.push({ name, path: rel, kind: "directory", children })
    } else if (meta.isFile()) {
      result.push({ name, path: rel, kind: "file", size: meta.size })
    }
  }
  return result
}

function statSafe(path: string) {
  try {
    return statSync(path, { throwIfNoEntry: false })
  } catch {
    return undefined
  }
}

export function workspaceTree(
  root: string,
  rel?: string,
  depth?: number,
): TreeEntry[] {
  const relative0 = rel ?? ""
  const { root: canonicalRoot, target } = safeTarget(root, relative0)
  if (!statSync(target).isDirectory())
    throw new Error("Requested path is not a directory")
  const count = { value: 0 }
  return buildTree(canonicalRoot, target, Math.min(depth ?? 3, 8), count)
}

export function workspaceReadFile(
  root: string,
  rel: string,
  maxBytes?: number,
): FileContent {
  const { target } = safeTarget(root, rel)
  const meta = statSync(target)
  if (!meta.isFile()) throw new Error("Requested path is not a file")
  const limit = Math.min(maxBytes ?? DEFAULT_MAX_BYTES, 10 * 1024 * 1024)
  const buffer = readFileSync(target)
  const truncated = buffer.length > limit
  const visible = buffer.subarray(0, Math.min(buffer.length, limit))
  let content: string
  try {
    content = new TextDecoder().decode(visible)
  } catch {
    throw new Error("Binary files cannot be displayed")
  }
  return { path: rel, content, size: meta.size, truncated }
}
