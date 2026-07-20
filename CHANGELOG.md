# Pichamber Changelog

## 0.3.0 - 2026-07-20

### Release
- First public npm release as the scoped package `@amagicpear/pichamber`.
- Added a `pichamber` bin entry that launches the backend via Bun.
- Added `prepublishOnly` script that runs `check` + `build` before publish.
- Added `.npmignore` to keep the published surface to `dist/`, `src-server/`, `bin/`, `assets/`, and the top-level docs.

### Internal (since 0.2.0)
- Subscribed to Pi model / thinking-level events instead of polling `get_state` round-trips; Pi is now the single source of truth.
- Switched the frontend end-to-end to Pi's native types — no local `ChatMessage` / `ModelInfo` / `reduceRuntimeEvent` clones remain.
- Removed `clampThinkingLevel` (Pi clamps via events) and added the per-model `thinkingLevelMap` filter; reasoning-level UI now matches exactly what the selected model supports.
- Loaded models globally instead of once per session.
- Fixed session / model / thinking-level lifecycle bugs around mid-session switches.
- Fixed WebSocket race on session start: now awaits socket open before sending commands, with a 10s open timeout and 15s start deadline.
- Aligned server-side CORS on every HTTP response (Vite dev origin → Bun backend).
- Resize rAF throttling plus `React.memo` on `Message` / `ChatView` plus `content-visibility: auto` for large-session rendering.

## 0.2.0 - 2026-07-20

### Architecture
- Replaced Tauri/Rust desktop stack with Bun/TypeScript HTTP+WebSocket server
- Frontend served by Vite in dev, embedded in Bun server in production
- Browser-first: just `bun run dev:all` and open `localhost:5173`

### Features
- Resizable sidebar (200–480px) and inspector (300–800px) with drag handles
- Panel widths persisted across restarts
- Escape key interrupts running agent prompts
- Sidebar session search with inline rename

### Fixes
- Scrolling now tracks streaming output reliably (scroll-event-based auto-follow)
- Stop/interrupt button works instantly (fire-and-forget abort, no 35s timeout)
- WebSocket race condition fixed — waits for open before sending session commands
- CORS headers on all HTTP responses (dev mode cross-origin from Vite to backend)
- Resize performance: rAF throttling, React.memo on Message/ChatView, content-visibility:auto

## 0.1.0 - 2026-04-15

- Added the React and Tauri desktop workspace.
- Added isolated Pi RPC runtimes with request correlation and generation filtering.
- Added streaming chat, thinking, tool activity, model controls, extension UI requests, and abort.
- Added projects, session tabs, Pi session history and resume support.
- Added a workspace-scoped file tree, file viewer, attachments, and right-side inspector.
- Added a macOS interactive PTY terminal with resize, restart, and maximize controls.
- Added command palette, settings, persisted themes, responsive layouts, and app icons.
- Added TypeScript, component-state, Rust security, RPC smoke, build, and browser acceptance checks.
- Defined Apple silicon macOS as the supported v0.1 development and release platform.
