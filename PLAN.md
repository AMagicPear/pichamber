# Pichamber implementation plan

## 1. Product boundary

Pichamber is a coding-agent workspace that runs entirely in the browser. It talks to a local Rust backend that manages Pi processes, the filesystem, and PTY terminals. No Electron, no Tauri — just a browser tab and a single background process.

Version 0.2 makes Pichamber a browser-first application, following OpenChamber's architecture: a local HTTP+WebSocket server that the browser connects to.

### v0.1 (done) — macOS desktop via Tauri
### v0.2 (now) — browser-first via local HTTP server

- Runs in any browser on the same machine (`localhost:1420`)
- Single Rust binary: `pichamber serve` starts the backend and opens the browser
- No Tauri, no Electron, no desktop framework dependency
- Works on macOS, Linux, and potentially Windows

### Deferred

Web/PWA remote access, GitHub/PR workflows, multi-agent, voice, mobile, package marketplace, SSH hosts, collaborative relay.

## 2. Architecture — v0.2

OpenChamber reference architecture:
```
Browser ──fetch/WS──> Express ──proxy──> OpenCode HTTP API
                                ├── PTY (bun-pty)
                                └── Event fan-out (SSE + WS)
```

Pichamber v0.2 architecture:
```
Browser ──fetch/WS──> Rust HTTP server (axum) ──stdin/stdout──> Pi RPC processes
                          │
                          ├── PTY management (portable-pty)
                          ├── File system (workspace-scoped)
                          └── Session listing (Pi JSONL store)
```

Key difference from OpenChamber: Pi has no HTTP API (`--mode rpc` is stdin/stdout only), so we can't proxy. Instead, the Rust backend directly manages Pi RPC processes and fans out their events to the browser via WebSocket.

### Transport layer

Replace Tauri IPC with standard web protocols:

| Function | v0.1 (Tauri) | v0.2 (HTTP/WS) |
|---|---|---|
| Start Pi | `invoke("rpc_start")` | `POST /api/rpc/start` |
| Send command | `invoke("rpc_send")` | `POST /api/rpc/:id/send` |
| Pi events | `listen("rpc-event")` | WS `/api/rpc/:id/events` |
| PTY start | `invoke("pty_start")` | `POST /api/pty/start` |
| PTY I/O | `invoke("pty_write")` | WS `/api/pty/:id` |
| List sessions | `invoke("list_all_sessions_grouped")` | `GET /api/sessions` |
| File tree | `invoke("workspace_tree")` | `GET /api/workspace/tree` |
| Read file | `invoke("workspace_read_file")` | `GET /api/workspace/file` |
| Delete session | `invoke("delete_session")` | `DELETE /api/sessions` |
| Find Pi | `invoke("find_pi")` | `GET /api/pi/path` |
| Stop Pi | `invoke("rpc_stop")` | `POST /api/rpc/:id/stop` |

Frontend transport abstraction (`src/api/`):
- `api-client.ts` — typed `fetch()` wrappers for all endpoints
- `event-stream.ts` — WebSocket subscription with auto-reconnect
- `tauri.ts` → deleted, replaced by `api-client.ts`
- Runtime detection: checks `window.__PICHAMBER_API_BASE__` for server mode

### Rust server (axum)

```
src-server/
  main.rs            # CLI entry: `pichamber serve`
  server.rs          # Axum router, static file serving, CORS
  routes/
    rpc.rs           # POST /api/rpc/start, /send, /stop
    rpc_ws.rs        # WS /api/rpc/:id/events (Pi stdout fan-out)
    sessions.rs      # GET /api/sessions, DELETE /api/sessions
    workspace.rs     # GET /api/workspace/tree, /file
    pty.rs           # POST /api/pty/start, WS /api/pty/:id
    health.rs        # GET /api/health
  state.rs           # Shared AppState (RpcRegistry, PtyState)
  rpc/
    registry.rs      # Moved from current src-tauri/src/rpc.rs
    process.rs       # Pi process spawn/kill lifecycle
  pty/
    manager.rs       # Moved from src-tauri/src/pty.rs
  sessions/
    index.rs         # Moved from src-tauri/src/sessions.rs
  workspace/
    fs.rs            # Moved from src-tauri/src/workspace.rs
  security/
    sandbox.rs       # Path validation, canonicalization
```

### Build pipeline

```
cargo build → pichamber binary
                   ├── embedded frontend dist/ (include_bytes!)
                   ├── HTTP server on localhost:1420
                   └── CLI: pichamber serve [--port 1420] [--open]
```

The Rust binary embeds the Vite-built frontend via `rust-embed` or `include_dir`. Single file distribution — no separate `dist/` folder, no `node_modules` at runtime.

### Project structure

```
pichamber/
├── package.json              # Frontend deps + scripts
├── vite.config.ts            # Vite config (outputs to dist/)
├── tsconfig.json             # TypeScript project references
├── index.html                # Vite entry HTML
├── Cargo.toml                # Rust workspace root
├── src/                      # Frontend (React + TypeScript)
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/                  # HTTP/WS client (replaces runtime/tauri.ts)
│   │   ├── client.ts
│   │   └── events.ts
│   ├── features/
│   │   ├── chat/
│   │   ├── files/
│   │   ├── terminal/
│   │   ├── settings/
│   │   └── workspace/
│   ├── runtime/              # Domain logic (kept, transport-agnostic)
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── rpc-client.ts     # Updated: uses api-client instead of Tauri invoke
│   │   ├── normalize.ts
│   │   ├── normalize-events.ts
│   │   └── use-pichamber.ts
│   ├── stores/
│   ├── components/
│   └── styles.css
├── src-server/               # Rust backend (replaces src-tauri/)
│   ├── main.rs
│   ├── server.rs
│   ├── state.rs
│   ├── routes/
│   ├── rpc/
│   ├── pty/
│   ├── sessions/
│   └── workspace/
└── tests/
```

### What gets deleted

- `src-tauri/` — entire directory (Tauri-specific)
- `src/runtime/tauri.ts` — replaced by `src/api/client.ts`
- `src/runtime/rpc-client.ts` — rewritten to use fetch/WS transport
- `src/features/workspace/SessionBrowser.tsx` — kept, just uses new API client
- `tauri.conf.json`, `capabilities/`, `build.rs` — all Tauri scaffolding
- `@tauri-apps/api`, `@tauri-apps/plugin-dialog` — npm deps
- All `isTauri()` checks — replaced with `isServer()` or direct API call

### What stays

- All React components (Sidebar, ChatView, Composer, Message, Inspector, ToolBlock, etc.)
- All stores (app-store.ts)
- All runtime domain logic (normalize.ts, normalize-events.ts, types.ts, registry.ts)
- All CSS (styles.css with OKLCH design tokens)
- The Pi session management model (read from `~/.pi/agent/sessions/`)

### v0.2 milestones

#### M6: HTTP transport scaffold
- Set up axum server with health endpoint
- Serve Vite-built frontend from embedded files
- Replace `tauri.ts` with `api/client.ts` (fetch-based)
- Move all Rust business logic from `src-tauri/` to `src-server/`
- Delete Tauri scaffolding
- `cargo build` produces a single `pichamber` binary

#### M7: WebSocket event streaming
- Add `/api/rpc/:id/events` WebSocket endpoint
- Fan out Pi stdout lines to WS clients, matching the current Tauri event envelope
- Auto-reconnect on WS disconnect with generation filtering
- Replace `rpc-client.ts` event listener with WS subscription

#### M8: Terminal via WebSocket
- Add `/api/pty/:id` WebSocket endpoint (binary PTY frames + JSON control)
- Port PTY manager from Tauri command model to WS model
- Keep existing `TerminalDock` component, swap xterm.js WebSocket URL

#### M9: Polish and release
- `pichamber serve --open` flow (start server + open browser)
- Handle CORS for development (Vite dev server on different port)
- Restore all existing functionality: file tree, session delete, Pi discovery
- Single-binary distribution for macOS (and optionally Linux)

### Definition of done for v0.2

`pichamber serve` starts a local server. Opening `localhost:1420` in any browser shows the full Pichamber workspace: sidebar with Pi sessions grouped by project, chat with streaming messages, composer with model selection, file inspector, and interactive terminal. All functionality from v0.1 works identically, but through HTTP/WS instead of Tauri IPC. No desktop framework required. Single binary distribution.

### Risks

- **WebSocket reliability**: the current Tauri event system is in-process and reliable; WS over localhost adds a network hop but should be near-zero latency on the same machine.
- **File dialogs**: `@tauri-apps/plugin-dialog` provided native open/save dialogs. In browser mode, fall back to `<input type="file" webkitdirectory>` for folder selection and standard file inputs.
- **PTY in browser**: xterm.js already works in browsers — just swap the WebSocket URL from Tauri's IPC channel to our WS endpoint. No xterm.js changes needed.
- **Single binary size**: embedding the Vite dist in the Rust binary adds ~2 MB (gzipped). Acceptable for a local dev tool.
