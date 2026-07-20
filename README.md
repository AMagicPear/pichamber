# Pichamber

![Pichamber screenshot](assets/screenshot.png)

Pichamber is a browser-based interface for the [Pi Coding Agent](https://github.com/badlogic/pi-mono). It combines Pi's extension-first RPC runtime with a project, session, chat, tool, file, and terminal workflow inspired by OpenChamber — all running in a browser tab, served by a local Bun/TypeScript backend.

No Electron, no Tauri: just `bun run dev:all` and open `localhost:1420`.

## Product direction

- **Browser-first**: a local HTTP+WebSocket server with a React frontend.
- **Pi-native**: `pi --mode rpc` and Pi JSONL sessions remain the runtime and source of truth.
- **Familiar workflow**: interaction density and workspace layout mirror OpenChamber without copying its source.
- **Thin host**: product-specific agent behavior belongs in Pi packages and extensions, not in Pichamber.
- **Workspace-scoped trust**: filesystem and command access constrained to explicitly opened directories.

## Features

- Sidebar that directly browses Pi's session store (`~/.pi/agent/sessions/`), grouped by working directory.
- Real Pi `--mode rpc` streaming with per-session process isolation.
- Assistant text, thinking, tool execution, errors, and extension UI requests.
- Model and thinking-level selection, stop, fork, file references, and session history.
- Workspace-scoped file tree and file viewer.
- Interactive PTY terminal powered by [`@xterm/xterm`](https://github.com/xtermjs/xterm.js) and Bun's PTY support.
- Command palette, light/dark/system themes, and keyboard navigation.
- Workspace path sandboxing, Pi session path validation, and generation-safe runtime events.

## Architecture

```
Browser ──fetch/WS──> Bun/TypeScript HTTP server ──stdin/stdout──> Pi RPC processes
                          │
                          ├── PTY management (Bun PTY)
                          ├── File system (workspace-scoped)
                          └── Session listing (Pi JSONL store)
```

- **Frontend**: React 19 + TypeScript + Vite 7, Zustand stores, OKLCH design tokens
- **Backend**: Bun/TypeScript HTTP + WebSocket server, serves frontend dist in production
- **No desktop framework**: no Electron, no Tauri — just a browser tab

## Development

Prerequisites: Node.js 22+, Bun 1.3+, and an installed Pi CLI.

```bash
bun install
bun run dev            # Vite dev server (frontend only)
bun run dev:all        # Full stack (Vite + backend, starts on localhost:1420)
```

## Verification

```bash
bun run check          # TypeScript check + ESLint
bun run test           # Vitest
bun run build          # Build frontend to dist/
```

The frontend is built separately (`bun run build`) and served by the Bun backend in production mode.

## Reference projects

- [openchamber](https://github.com/AMagicPear/openchamber): product interaction, responsive layout, visual hierarchy, architecture, and transport layer reference.
- [pi-desktop](https://github.com/badlogic/pi-desktop): Pi RPC, session, process lifecycle, extension UI, and native host reference.
