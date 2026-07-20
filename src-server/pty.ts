import { statSync } from "node:fs"
import { resolve, isAbsolute } from "node:path"

export interface PtyHandle {
  id: string
  terminal: any
  proc: any
  subscribers: Set<(data: string) => void>
}

export class PtyState {
  private handles = new Map<string, PtyHandle>()

  start(options: {
    cwd: string
    cols: number
    rows: number
    shell?: string
  }): { ptyId: string } {
    let cwd: string
    try {
      cwd = isAbsolute(options.cwd) ? options.cwd : resolve(process.cwd(), options.cwd)
      const stat = statSync(cwd)
      if (!stat.isDirectory()) {
        throw new Error("Terminal directory is not a folder")
      }
    } catch {
      throw new Error("Invalid terminal directory")
    }

    const shell = options.shell ?? process.env.SHELL ?? "/bin/zsh"
    const id = crypto.randomUUID()

    const terminal = new (Bun as any).Terminal({
      cols: Math.max(2, options.cols),
      rows: Math.max(2, options.rows),
      data: (term: any, data: Uint8Array) => {
        const text = new TextDecoder().decode(data)
        const handle = this.handles.get(id)
        if (handle) {
          for (const sub of handle.subscribers) sub(text)
        }
      },
    })

    const proc = Bun.spawn([shell], {
      cwd,
      terminal,
      env: process.env,
    })

    const handle: PtyHandle = {
      id,
      terminal,
      proc,
      subscribers: new Set(),
    }
    this.handles.set(id, handle)

    proc.exited.then(() => {
      const h = this.handles.get(id)
      if (h) {
        for (const sub of h.subscribers) sub("\x1b[31mTerminal exited\x1b[0m\r\n")
        h.subscribers.clear()
      }
      try {
        terminal.close()
      } catch {}
    })

    return { ptyId: id }
  }

  write(ptyId: string, data: string): void {
    const handle = this.handles.get(ptyId)
    if (!handle) throw new Error("Terminal is not running")
    handle.terminal.write(data)
  }

  resize(ptyId: string, cols: number, rows: number): void {
    const handle = this.handles.get(ptyId)
    if (!handle) throw new Error("Terminal is not running")
    handle.terminal.resize(Math.max(2, cols), Math.max(2, rows))
  }

  subscribe(ptyId: string, cb: (data: string) => void): () => void {
    const handle = this.handles.get(ptyId)
    if (!handle) throw new Error("PTY not found")
    handle.subscribers.add(cb)
    return () => handle.subscribers.delete(cb)
  }

  stop(ptyId: string): void {
    const handle = this.handles.get(ptyId)
    if (handle) {
      try {
        handle.proc.kill()
      } catch {}
      try {
        handle.terminal.close()
      } catch {}
      this.handles.delete(ptyId)
    }
  }

  stopAll(): void {
    for (const id of [...this.handles.keys()]) this.stop(id)
  }
}
