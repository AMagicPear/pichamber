# pichamber

A browser-based workspace for the Pi Coding Agent. Vue 3 + Bun thin shell wrapping `pi` with a real shell terminal.

## Install from npm

Requires [Bun](https://bun.sh) (the backend runs on it).

```sh
npm i -g @amagicpear/pichamber
cd your-project
pichamber
```

The command starts a local background server when needed, creates a session for
the current directory, and opens it in your browser. Later invocations reuse the
same server.

```sh
pichamber open                # open the current workspace
pichamber open ../another-project
pichamber --json open         # print the session URL as JSON without opening a browser
pichamber status              # inspect the background server
pichamber logs -f             # follow server logs
pichamber stop                # stop it cleanly

# Foreground mode for debugging, containers, or an SSH tunnel
pichamber serve --host 127.0.0.1 --port 3000
```

Run `pichamber --help` for all options. State and logs are stored under
`~/Library/Application Support/pichamber` on macOS,
`$XDG_STATE_HOME/pichamber` on Linux, and `%LOCALAPPDATA%\\pichamber` on
Windows. Set `PICHAMBER_STATE_DIR` to override that location or
`PICHAMBER_PORT` to change the default port.

## Develop

A monorepo workspace using [Bun](https://bun.sh) workspaces.

## Acknowledgements

- [earendil-works/pi](https://github.com/earendil-works/pi) — provides the coding-agent runtime used by the server.
- [openchamber/openchamber](https://github.com/openchamber/openchamber) — served as a reference for the UI design.

## License

pichamber is MIT — see [LICENSE](./LICENSE). Bundled third-party packages
(pi-coding-agent, markstream-vue, mermaid, katex, vue, monaco-editor,
catppuccin-vsc-icons, and others) are listed with their respective
licenses in [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md); the
upstream LICENSE files ship in `node_modules/<package>/LICENSE` after
`bun install`.

## Project structure

```
pichamber/
├── package.json              # workspace root, dev orchestration scripts
├── tsconfig.json             # references all packages
├── .oxlintrc.json            # lint config applied to all packages
├── bun.lock
└── packages/
    ├── web/                  # Vue 3 + Vite frontend (@amagicpear/pichamber-web)
    └── server/               # Bun HTTP server (@amagicpear/pichamber-server)
```

| Package                                  | Stack                                | Purpose     |
| ---------------------------------------- | ------------------------------------ | ----------- |
| [`@amagicpear/pichamber-web`](./packages/web)       | Vue 3 (rc) · Vite · Pinia · Vue Router | Browser SPA |
| [`@amagicpear/pichamber-server`](./packages/server) | Bun runtime                          | HTTP server |

Remote-host and Pi runtime decisions are documented in
[`docs/architecture.md`](./docs/architecture.md).

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3

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

# Run focused logic tests
bun run test

# Lint everything with oxlint
bun run lint
```

Per-package scripts use Bun's `--filter`:

```sh
bun --filter @amagicpear/pichamber-web dev
bun --filter @amagicpear/pichamber-server start
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
