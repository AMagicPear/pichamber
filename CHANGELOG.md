# Pichamber Changelog

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
