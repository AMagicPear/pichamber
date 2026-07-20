# Pichamber implementation plan

## 1. Product boundary

Pichamber is a coding-agent workspace that runs entirely in the browser. It talks to a local Bun/TypeScript backend that manages Pi processes, the filesystem, and PTY terminals. No Electron, no Tauri — just a browser tab and a single background process.

### v0.1 (done) — macOS desktop via Tauri
### v0.2 (done) — browser-first via Bun/TS HTTP+WS server

- Runs in any browser on the same machine
- Single `bun run dev:all` starts everything
- No Tauri, no Electron, no desktop framework dependency
- Works on macOS and Linux

### v0.3 (next)

Polish and complete the OpenChamber workflow parity:

- **File open from tool blocks**: clicking a file path in a `read`/`write` tool result opens it in the inspector
- **Diff viewer**: side-by-side or unified diff rendering in tool blocks for `write`/`edit` results
- **Better tool rendering**: syntax-highlighted code blocks in tool inputs/outputs
- **Session export/import**: share sessions as files
- **Keyboard shortcuts parity**: match OpenChamber's full shortcut set
- **Performance**: continue optimizing large session rendering
- **Accessibility**: keyboard navigation, screen reader support, focus management

### Deferred

Web/PWA remote access, GitHub/PR workflows, multi-agent, voice, mobile, package marketplace, SSH hosts, collaborative relay.

## 2. Architecture — v0.2

```
Browser ──fetch/WS──> Bun/TypeScript HTTP server ──stdin/stdout──> Pi RPC processes
                          │
                          ├── PTY management (Bun.Terminal)
                          ├── File system (workspace-scoped)
                          └── Session listing (Pi JSONL store)
```

### Transport layer

| Function | Endpoint |
|---|---|
| Start Pi | `POST /api/rpc/start` |
| Send command | `POST /api/rpc/:id/send` |
| Pi events | WS `/api/rpc/:id/events` |
| PTY start | `POST /api/pty/start` |
| PTY I/O | WS `/api/pty/:id` |
| List sessions | `GET /api/sessions` |
| File tree | `GET /api/workspace/tree` |
| Read file | `GET /api/workspace/file` |
| Delete session | `DELETE /api/sessions` |
| New session | `GET /api/sessions/new` |
| Find Pi | `GET /api/pi/path` |
| Stop Pi | `POST /api/rpc/:id/stop` |

### Project structure

```
pichamber/
├── package.json
├── vite.config.ts
├── index.html
├── src/                      # Frontend (React + TypeScript)
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/
│   │   └── client.ts         # HTTP/WS client
│   ├── features/
│   │   ├── chat/              # ChatView, Composer, Message, ToolBlock, ThinkingBlock
│   │   ├── files/             # Inspector, file tree
│   │   ├── terminal/          # TerminalDock (xterm.js)
│   │   ├── settings/          # SettingsModal
│   │   └── workspace/         # Sidebar, WorkspaceHeader
│   ├── hooks/
│   │   └── use-resizable.ts   # Panel resize hook
│   ├── runtime/               # Domain logic
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── rpc-client.ts
│   │   ├── normalize.ts
│   │   ├── normalize-events.ts
│   │   └── use-pichamber.ts
│   ├── stores/
│   │   └── app-store.ts
│   ├── components/            # Shared UI (Markdown, BrandLogo, etc.)
│   └── styles.css
├── src-server/                # Backend (Bun/TypeScript)
│   ├── server.ts              # HTTP + WS server
│   ├── rpc.ts                 # Pi process management
│   ├── pty.ts                 # PTY terminal management
│   ├── sessions.ts            # Pi session store reader
│   └── workspace.ts           # File tree + reader
└── scripts/
    └── dev-all.ts             # Dev launcher (Vite + backend)
```

### Key design decisions

- **Pi is stdin/stdout only**: `pi --mode rpc` reads JSON commands from stdin and writes JSON events to stdout. No HTTP API to proxy.
- **Process-per-session**: each Pi session tab gets its own `pi --mode rpc` child process, isolated by working directory.
- **Generation filtering**: every process restart increments a generation number; WebSocket messages carry the generation, letting clients ignore stale events from killed processes.
- **Frontend is transport-agnostic**: `RpcClient` wraps fetch + WebSocket into a simple `request()`/`onEvent()` interface. Swapping transports means changing one class.
- **CORS in dev**: frontend (Vite :5173) and backend (Bun :1420) run on different ports. All responses carry CORS headers.
