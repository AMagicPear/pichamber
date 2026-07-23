# pichamber

A monorepo workspace for the **pichamber** project, using [Bun](https://bun.sh) workspaces.

## Project structure

```
pichamber/
├── package.json              # workspace root, dev orchestration scripts
├── tsconfig.json             # references all packages
├── eslint.config.ts          # lint config applied to all packages
├── .oxlintrc.json
├── bun.lock
└── packages/
    ├── web/                  # Vue 3 + Vite frontend (@pichamber/web)
    ├── server/               # Bun HTTP server (@pichamber/server)
    └── shared/               # framework-agnostic shared types/utils (@pichamber/shared)
```

| Package                                          | Stack                       | Purpose                                      |
| ------------------------------------------------ | ---------------------------- | -------------------------------------------- |
| [`@pichamber/web`](./packages/web)              | Vue 3 (rc) · Vite · Pinia · Vue Router | Browser SPA                              |
| [`@pichamber/server`](./packages/server)         | Bun runtime                  | HTTP server                                 |
| [`@pichamber/shared`](./packages/shared)         | TypeScript                   | Types, constants, code shared by web+server  |

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

# Run web's Vitest unit tests
bun run test:unit

# Lint everything (oxlint + eslint)
bun run lint
```

Per-package scripts use Bun's `--filter`:

```sh
bun --filter @pichamber/web dev
bun --filter @pichamber/server start
bun --filter @pichamber/shared type-check
```

## Conventions

- Vue 3 + Vite + Pinia + Vue Router conventions live in `packages/web/`.
- The server uses Bun's native `Bun.serve()` HTTP runtime — keep imports Bun-compatible.
- Anything imported by both `web` and `server` belongs in `packages/shared`.
- Use TypeScript path aliases within a package (e.g. `@/*` → `packages/web/src/*`), and the `workspace:*` protocol across packages (e.g. `@pichamber/shared`).

## Type-checking with project references

The root `tsconfig.json` references each package via project references. To type-check everything:

```sh
bun run type-check
```

This uses `tsc --build` under the hood for each package.

## Linting

ESLint and oxlint are configured at the root and scan `packages/*/src/**`. Run:

```sh
bun run lint
```
