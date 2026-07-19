# ADR 0001: Desktop product and Pi runtime boundary

- Status: Accepted for planning
- Date: 2026-04-15

## Context

OpenChamber provides the target interaction model but is designed around OpenCode and a large multi-platform monorepo. Pi Desktop provides a proven Pi RPC and Tauri host boundary but uses Lit and a deliberately minimal UI. Pichamber needs OpenChamber-like product depth while remaining native to Pi.

## Decision

Build a new macOS desktop application with React 19, TypeScript, Vite, Tailwind CSS, Zustand, Tauri 2, and Rust. macOS is the sole supported development and release platform.

Use `pi --mode rpc` as the only agent execution boundary. Run one Pi process per live session, preserve Pi JSONL sessions as the transcript source of truth, and isolate process generations. Keep raw Pi protocol knowledge behind a tested adapter and expose normalized domain events to the UI.

Use OpenChamber as an interaction and visual reference only. Reimplement selected workflows and avoid source-level coupling. Keep agent policy and optional behavior in Pi packages and extensions.

Ship desktop workflows first. Web, mobile, remote access, and OpenChamber's broader collaboration and GitHub features are deferred.

## Consequences

- React makes OpenChamber-like component composition and state partitioning straightforward, but Pi Desktop's Lit components cannot be reused directly.
- The new adapter adds initial work but localizes Pi protocol drift and makes UI tests deterministic.
- Tauri provides a smaller native shell than Electron, while Rust must own process, PTY, filesystem, and permission correctness.
- A desktop-only MVP keeps the first release tractable and leaves room for a later transport-neutral application layer.

## Revisit when

- Pi publishes a versioned RPC SDK that can replace the local adapter.
- Remote or browser access becomes a committed release objective.
- One-process-per-session causes measured resource problems under realistic workloads.
