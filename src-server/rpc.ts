import { spawn, type Subprocess } from "bun"
import { resolve, isAbsolute } from "node:path"

const DEFAULT_INSTANCE = "main"

export interface RpcEvent {
  instanceId: string
  generation: number
  line: string
}

interface RpcProcess {
  stdin: number
  proc: Subprocess
  generation: number
  pid?: number
  eventsSubscribers: Set<(event: RpcEvent) => void>
  stderrSubscribers: Set<(event: RpcEvent) => void>
}

export class RpcState {
  private processes = new Map<string, RpcProcess>()
  private generations = new Map<string, number>()

  private validInstanceId(value: string): boolean {
    return (
      value.length > 0 &&
      value.length <= 256 &&
      [...value].every((c) =>
        c.match(/[A-Za-z0-9\-_:_.@#+/]/) !== null,
      )
    )
  }

  private expandHome(path: string): string {
    if (path === "~") return os.homedir()
    if (path.startsWith("~/")) return `${os.homedir()}/${path.slice(2)}`
    return path
  }

  discoverPi(overridePath?: string): string {
    if (overridePath && overridePath.trim()) {
      const expanded = this.expandHome(overridePath)
      if (Bun.file(expanded).exists()) return expanded
      throw new Error(`Configured Pi executable does not exist: ${expanded}`)
    }
    const envPath = process.env.PICHAMBER_PI_PATH
    if (envPath) {
      const candidate = this.expandHome(envPath)
      if (Bun.file(candidate).exists()) return candidate
    }
    const which = (Bun as any).which("pi")
    if (which) return which
    const home = os.homedir()
    for (const relative of [".bun/bin/pi", ".local/bin/pi", ".npm-global/bin/pi"]) {
      const candidate = `${home}/${relative}`
      if (Bun.file(candidate).exists()) return candidate
    }
    throw new Error("Pi CLI was not found. Install pi-coding-agent or configure its path.")
  }

  findPi(piPath?: string): string {
    return this.discoverPi(piPath)
  }

  async start(
    options: { cwd: string; piPath?: string; env?: Record<string, string> },
    instanceId?: string,
  ): Promise<{ instanceId: string; generation: number; executable: string }> {
    const id = instanceId ?? DEFAULT_INSTANCE
    if (!this.validInstanceId(id)) {
      throw new Error("Invalid runtime instance ID")
    }

    let cwd: string
    try {
      const { statSync } = await import("node:fs")
      cwd = isAbsolute(options.cwd) ? options.cwd : resolve(process.cwd(), options.cwd)
      if (!statSync(cwd).isDirectory()) {
        throw new Error("Project path is not a directory")
      }
    } catch {
      throw new Error("Project directory is unavailable")
    }

    await this.stop(id)

    const executable = this.discoverPi(options.piPath)
    const generation = (this.generations.get(id) ?? 0) + 1
    this.generations.set(id, generation)

    const proc = spawn(
      [executable, "--mode", "rpc"],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        env: options.env ? { ...process.env, ...options.env } : process.env,
        detached: true,
      },
    )

    const rpcProcess: RpcProcess = {
      stdin: 1,
      proc,
      generation,
      pid: proc.pid,
      eventsSubscribers: new Set(),
      stderrSubscribers: new Set(),
    }
    this.processes.set(id, rpcProcess)

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    ;(async () => {
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          this.emit(id, "events", line, generation, rpcProcess)
        }
      }
    })()

    const errReader = proc.stderr.getReader()
    ;(async () => {
      let buffer = ""
      while (true) {
        const { done, value } = await errReader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          this.emit(id, "stderr", line, generation, rpcProcess)
        }
      }
    })()

    return { instanceId: id, generation, executable }
  }

  private emit(
    id: string,
    kind: "events" | "stderr",
    line: string,
    generation: number,
    proc: RpcProcess,
  ): void {
    const event: RpcEvent = { instanceId: id, generation, line }
    const subs = kind === "events" ? proc.eventsSubscribers : proc.stderrSubscribers
    for (const sub of subs) sub(event)
  }

  async send(command: string, instanceId?: string): Promise<void> {
    const id = instanceId ?? DEFAULT_INSTANCE
    try {
      JSON.parse(command)
    } catch (e) {
      throw new Error(`RPC command is not valid JSON: ${e}`)
    }
    const proc = this.processes.get(id)
    if (!proc) throw new Error(`Runtime ${id} is not running`)
    const stdin = proc.proc.stdin
    if (!stdin) throw new Error(`Runtime ${id} stdin is not available`)
    await stdin.write(new TextEncoder().encode(command + "\n"))
  }

  async stop(id: string): Promise<void> {
    const proc = this.processes.get(id)
    if (!proc) return
    this.processes.delete(id)
    if (proc.proc.exitCode !== null) return
    const pid = proc.pid
    if (pid !== undefined) {
      try {
        process.kill(-pid, "SIGTERM")
      } catch {}
    }
    try {
      proc.proc.kill()
    } catch {}
    await proc.proc.exited.catch(() => {})
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.processes.keys()]) {
      await this.stop(id)
    }
  }

  hasInstance(id: string): boolean {
    return this.processes.has(id)
  }

  subscribeEvents(id: string, cb: (event: RpcEvent) => void): () => void {
    const proc = this.processes.get(id)
    if (!proc) throw new Error("Instance not found")
    proc.eventsSubscribers.add(cb)
    return () => proc.eventsSubscribers.delete(cb)
  }

  subscribeStderr(id: string, cb: (event: RpcEvent) => void): () => void {
    const proc = this.processes.get(id)
    if (!proc) throw new Error("Instance not found")
    proc.stderrSubscribers.add(cb)
    return () => proc.stderrSubscribers.delete(cb)
  }
}

import os from "node:os"
