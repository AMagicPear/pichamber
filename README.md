# Pichamber

[![npm version](https://img.shields.io/npm/v/@amagicpear/pichamber.svg)](https://www.npmjs.com/package/@amagicpear/pichamber)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Pichamber screenshot](assets/screenshot.png)

Pichamber is a browser-based interface for the [Pi Coding Agent](https://github.com/badlogic/pi-mono). It combines Pi's extension-first RPC runtime with a project, session, chat, tool, file, and terminal workflow inspired by OpenChamber — all running in a browser tab, served by a local Bun/TypeScript backend.

No Electron, no Tauri: just install and open `localhost:1420`.

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

## Requirements

Pichamber's backend runs on Bun and shells out to the Pi CLI. Install both before continuing:

- Node.js 22+ (only for `npx pichamber`; not needed if you use Bun)
- [Bun](https://bun.sh) 1.3+
- [Pi Coding Agent CLI](https://github.com/badlogic/pi-mono) — install per its README

## Installing the published release

```bash
# Once on the system
npm install -g @amagicpear/pichamber

# Start the backend (Bun must be installed and on PATH)
pichamber
```

The launcher opens Pichamber at <http://localhost:1420/>. Use the workspace picker in the sidebar to point at a project directory.

## Developing from source

```bash
git clone https://github.com/AMagicPear/pichamber.git
cd pichamber
bun install
bun run dev            # Vite dev server (frontend only, on :5173)
bun run dev:all        # Full stack (Vite + backend, served on :1420)
```

The Bun backend uses `src-server/server.ts` and spawns Pi processes via stdin/stdout. See `AGENTS.md` for the project's copy-from-Pi conventions.

## Verification

```bash
bun run check          # TypeScript check + ESLint
bun run test           # Vitest
bun run build          # Build frontend to dist/
```

In production the backend serves the built `dist/` directory from the same origin, so the dev-mode cross-origin setup disappears at runtime.

## Releasing

This repository is published to npm as `@amagicpear/pichamber`. To publish a new version:

```bash
# 1. Update CHANGELOG.md and any version-bumped identifiers.
# 2. Run the safety gate that mirrors `prepublishOnly`:
bun run check && bun run build
# 3. Tag and publish:
git tag v0.x.y
npm login                 # one-time; only the owner of @amagicpear can publish
npm publish --access public
```

`prepublishOnly` reruns `check` + `build` automatically, so an accidental `npm publish` on a dirty tree is hard to make.

## Reference projects

- [openchamber](https://github.com/openchamber/openchamber): product interaction, responsive layout, visual hierarchy, architecture, and transport layer reference.
- [pi-desktop](https://github.com/gustavonline/pi-desktop): Pi RPC, session, process lifecycle, extension UI, and native host reference.
