import { spawn } from "bun"

const BACKEND_PORT = process.env.PICHAMBER_PORT ?? "1420"

const procs = [
  {
    name: "server",
    cmd: ["bun", "run", "src-server/server.ts"],
    env: { ...process.env, PICHAMBER_PORT: BACKEND_PORT },
  },
  {
    name: "web",
    cmd: ["bun", "run", "dev"],
    env: process.env,
  },
]

const children = procs.map((p) => {
  const child = spawn(p.cmd, {
    env: p.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const tag = `\x1b[36m[${p.name}]\x1b[0m`
  const pipe = (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    ;(async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split("\n")) {
          if (line) console.log(`${tag} ${line}`)
        }
      }
    })()
  }
  pipe(child.stdout)
  pipe(child.stderr)
  console.log(`${tag} started (pid ${child.pid})`)
  return child
})

  const shutdown = () => {
    console.log("\n\x1b[33m shutting down dev processes…\x1b[0m")
    for (const c of children) {
      try {
        c.kill()
      } catch {
        /* ignore */
      }
    }
    process.exit(0)
  }


process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

console.log(
  `\x1b[32m▶ dev running\x1b[0m — open \x1b[1mhttp://localhost:5173\x1b[0m (frontend) · backend on :${BACKEND_PORT}`,
)
