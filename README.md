# Pichamber

Pichamber is a desktop interface for the [Pi Coding Agent](https://github.com/badlogic/pi-mono). It combines Pi's extension-first RPC runtime with a project, session, chat, tool, file, and terminal workflow inspired by OpenChamber.

Version 0.1 provides the first complete local desktop workflow for macOS, Windows, and Linux.

## Product direction

- Desktop-first: macOS, Windows, and Linux through Tauri 2.
- Pi-native: `pi --mode rpc` and Pi JSONL sessions remain the runtime and source of truth.
- Familiar workflow: interaction density and workspace layout should stay close to OpenChamber without copying its source.
- Thin host: product-specific agent behavior belongs in Pi packages and extensions, not the desktop shell.
- Workspace-scoped trust: filesystem and command access must be constrained to explicitly opened projects.

## Features

- Multi-project and multi-session workspace with persisted tabs.
- Real Pi `--mode rpc` streaming with isolated per-session processes.
- Assistant text, thinking, tool execution, errors, and extension UI requests.
- Model and thinking-level selection, stop, follow-up, file references, and session history.
- Workspace-scoped file tree and file viewer.
- Interactive PTY terminal powered by `portable-pty` and xterm.js.
- Command palette, light/dark/system themes, narrow-window layouts, and keyboard focus states.
- Workspace path sandboxing, Pi session path validation, and generation-safe runtime events.

## Stack

- React 19, TypeScript, Vite 7
- Tailwind CSS 4 and semantic CSS tokens
- Zustand stores with per-session runtime state
- Tauri 2 with a Rust process and native capability layer
- Vitest, React Testing Library, Rust tests, and Playwright smoke tests

See [PLAN.md](PLAN.md) for scope, architecture, milestones, and acceptance criteria. Key decisions are recorded under [docs/decisions](docs/decisions).

## Development

Prerequisites: Node.js 22+, Bun 1.3+, Rust, the Tauri 2 platform prerequisites, and an installed Pi CLI.

```bash
bun install
bun run dev:desktop
```

The browser-only UI harness is available at `bun run dev`. It uses a visibly deterministic demo runtime because browsers cannot launch Pi or a PTY.

## Verification

```bash
bun run check
bun run test
bun run build:frontend
bun run check:rust
bun run test:rust
bun run build
```

Production bundles are written under `src-tauri/target/release/bundle/`.

## Reference projects

- `../openchamber`: product interaction, responsive layout, visual hierarchy, and tool presentation reference.
- `../pi-desktop`: Pi RPC, session, process lifecycle, extension UI, and native host reference.

Both references are MIT licensed. Pichamber should reimplement the required behavior behind its own contracts rather than importing internal modules or copying components.
