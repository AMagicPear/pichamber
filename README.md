# pichamber

A monorepo workspace for the **pichamber** project, using [Bun](https://bun.sh) workspaces.

## Acknowledgements

- [earendil-works/pi](https://github.com/earendil-works/pi) — provides the coding-agent runtime used by the server.
- [openchamber/openchamber](https://github.com/openchamber/openchamber) — served as a reference for the UI design.

## Project structure

```
pichamber/
├── package.json              # workspace root, dev orchestration scripts
├── tsconfig.json             # references all packages
├── .oxlintrc.json            # lint config applied to all packages
├── bun.lock
└── packages/
    ├── web/                  # Vue 3 + Vite frontend (@pichamber/web)
    └── server/               # Bun HTTP server (@pichamber/server)
```

| Package                                  | Stack                                | Purpose     |
| ---------------------------------------- | ------------------------------------ | ----------- |
| [`@pichamber/web`](./packages/web)       | Vue 3 (rc) · Vite · Pinia · Vue Router | Browser SPA |
| [`@pichamber/server`](./packages/server) | Bun runtime                          | HTTP server |

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- Node ≥ 22.18 (only needed for tooling that runs through Node — the server itself uses Bun)

## Setup

```sh
bun install
```

This installs all workspaces' dependencies in one pass thanks to Bun workspaces.

## Daily scripts

Run from the repo root:

```sh
# Start web dev server (Vite, http://localhost:5173) AND server (Bun, http://localhost:3000)
bun run dev

# Start them individually
bun run dev:web
bun run dev:server

# Build everything
bun run build

# Type-check all packages (uses project references)
bun run type-check

# Lint everything with oxlint
bun run lint
```

Per-package scripts use Bun's `--filter`:

```sh
bun --filter @pichamber/web dev
bun --filter @pichamber/server start
```

## Conventions

- Vue 3 + Vite + Pinia + Vue Router conventions live in `packages/web/`.
- The server uses Bun's native `Bun.serve()` HTTP runtime — keep imports Bun-compatible.
- Use TypeScript path aliases within a package (e.g. `@/*` → `packages/web/src/*`).

## Type-checking with project references

The root `tsconfig.json` references each package via project references. To type-check everything:

```sh
bun run type-check
```

This uses `tsc --build` under the hood for each package.

## Linting

oxlint is configured at the root and scans the workspace. Run:

```sh
bun run lint
```
