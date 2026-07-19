# Pichamber implementation plan

## 1. Product boundary

Pichamber v0.1 is a desktop coding-agent workspace for a single local user. Its primary job is to open a project, start or resume Pi sessions, and keep chat, tools, files, diffs, and a terminal visible in one coherent workspace.

### MVP

- Open, pin, reorder, and remove local projects.
- Create, resume, rename, fork, search, and delete Pi sessions.
- Stream user, assistant, thinking, and tool activity into a stable timeline.
- Compose prompts with attachments, file references, model choice, thinking level, stop, steer, and queued follow-up.
- Render purpose-built tool states for shell, file reads/writes, diffs, searches, tasks, and generic extension tools.
- Handle extension UI requests such as confirm, select, input, editor, notification, and status.
- Open referenced files and diffs in a resizable right pane.
- Run a real PTY in a resizable bottom dock rooted at the project directory.
- Configure Pi discovery/path, theme, notifications, and basic runtime preferences.
- Show actionable onboarding, compatibility, process, and provider errors.

### Deferred until after v0.1

Web/PWA and remote access, GitHub/PR workflows, multi-agent orchestration, voice, mobile, package marketplace UI, auto-update, mini-chat, SSH hosts, and collaborative relay are excluded. Pi's existing slash commands, skills, prompts, packages, and extensions remain available through runtime discovery.

## 2. Interaction and visual direction

The UI should reproduce OpenChamber's information architecture and interaction expectations, not its source code.

```text
+----------------+-----------------------------+------------------+
| projects       | session header / tabs       | file / diff      |
| sessions       +-----------------------------+ inspector        |
|                |                             |                  |
| status         | chat timeline               |                  |
|                |                             |                  |
|                +-----------------------------+------------------+
| settings       | composer                    |                  |
+----------------+-----------------------------+------------------+
|                docked terminal                                  |
+-----------------------------------------------------------------+
```

- Quiet, dense desktop tool rather than a marketing interface.
- Left project/session rail, central chat, optional right inspector, and bottom terminal.
- Chat measure defaults near `48rem`; tool output can use the available workspace width.
- Compact rows, restrained radii of at most 8px, visible keyboard focus, and stable control dimensions.
- Light and dark themes use semantic tokens for surfaces, borders, text, status, syntax, tools, and diffs. Do not copy OpenChamber's theme values verbatim.
- Lucide icons, icon buttons for familiar actions, tooltips for ambiguous controls, and text labels only for commands that need them.
- Desktop starts with the full shell. Narrow windows turn side panes into drawers without changing the underlying navigation model.
- Motion is limited to pane transitions, streaming activity, and disclosure state; `prefers-reduced-motion` is respected.

The memorable element is the activity rail inside each assistant turn: thinking, tool calls, permission waits, and final output share one chronological spine. It preserves Pi's runtime detail while keeping the conversation scannable.

## 3. Architecture

```text
React UI
  -> application services and normalized domain events
    -> typed Tauri bridge
      -> Rust native host
        -> one `pi --mode rpc` process per live session
        -> workspace-scoped filesystem and PTY services
```

Dependency direction is one-way. Components cannot call Tauri APIs, read files, or write Pi RPC lines directly. They use application services. Pi-specific event shapes terminate in `runtime/pi`; the rest of the UI consumes normalized events.

Pi JSONL session files under `~/.pi/agent/sessions` are authoritative. Pichamber persists only shell state such as projects, tabs, pane sizes, drafts, unread markers, and preferences. It must not maintain a competing transcript database in v0.1.

### Proposed structure

```text
src/
  app/                 bootstrap, routing, providers, command registry
  components/          shared controls and overlays
  features/
    workspace/         projects, session tree, tabs, layout
    chat/              timeline, messages, activity rail, composer
    files/             tree, viewer, diff inspector
    terminal/          PTY dock
    settings/          runtime, appearance, notifications
  runtime/
    contracts/         normalized commands, events, capability types
    pi/                Pi protocol adapter, fixtures, compatibility probe
    tauri/             typed invoke/listen transport
  stores/              keyed runtime stores and persisted shell stores
  styles/              reset, semantic tokens, typography, utilities
src-tauri/
  src/
    commands/          narrow Tauri command modules
    rpc/               process registry, JSONL transport, generations
    sessions/          Pi JSONL index and metadata parsing
    fs/                canonicalization and workspace sandbox
    pty/               platform PTY lifecycle
    config/            app settings and Pi executable discovery
  capabilities/        least-privilege Tauri policies
tests/
  fixtures/pi-rpc/     captured, redacted protocol fixtures
  e2e/                 critical desktop workflows
docs/decisions/        architecture decision records
```

## 4. Runtime contracts

The Rust-to-TypeScript envelope is owned by Pichamber and remains stable even when Pi changes:

```ts
type RuntimeEnvelope = {
  instanceId: string;
  generation: number;
  sequence: number;
  receivedAt: string;
  payload: PiRpcLine;
};

type DomainEvent =
  | { type: "message.delta"; messageId: string; text: string }
  | { type: "message.completed"; messageId: string; usage?: Usage }
  | { type: "thinking.delta"; turnId: string; text: string }
  | { type: "tool.started"; call: ToolCall }
  | { type: "tool.updated"; callId: string; update: unknown }
  | { type: "tool.completed"; callId: string; result: ToolResult }
  | { type: "ui.requested"; request: ExtensionUiRequest }
  | { type: "runtime.failed"; error: RuntimeError };
```

The names above are Pichamber domain events, not assumptions about raw Pi event names. Before chat implementation, capture redacted fixtures from the supported Pi version for prompt, thinking, tool, abort, compact, fork, model switch, extension UI, malformed output, and process exit. The adapter is exhaustively tested against those fixtures and retains unknown raw events for diagnostics.

Each runtime request has an ID and timeout. Every emitted line carries `instanceId`, `generation`, and a monotonic `sequence`. A restarted process increments generation; listeners silently reject old generations and duplicate sequence numbers. Closing a tab stops its process tree and removes listeners. Switching tabs does not stop background work.

## 5. State ownership

- `shellStore`, persisted: projects, open tabs, active tab, pane visibility/sizes, unread markers.
- `settingsStore`, persisted: appearance, Pi binary override, notification and terminal preferences.
- `runtimeStoreRegistry`, ephemeral and keyed by tab: connection state, generation, pending requests, capability report.
- `chatStoreRegistry`, ephemeral and keyed by session: normalized messages, activities, streaming and errors. Rehydrated from Pi session content.
- `composerStoreRegistry`, session-scoped: draft, attachments, queue, model, thinking level.
- `overlayStore`, ephemeral: permission/extension requests, dialogs, palette, toasts.
- `terminalStoreRegistry`, ephemeral and keyed by project: PTY identity, dimensions, status.

Stores expose focused selectors. Event reduction is idempotent by message/call ID; deltas never append after completion. Unknown or out-of-order updates trigger a state refresh when Pi supports it, otherwise an inline recoverable error.

## 6. Security rules

- Canonicalize both workspace root and target path in Rust before every filesystem operation; reject traversal and symlink escapes.
- Do not grant recursive `$HOME` access through broad Tauri capabilities.
- The frontend receives opaque handles where a native resource can be represented without a raw path.
- Spawn Pi and PTYs with an explicit cwd and controlled inherited environment. Never interpolate shell commands in Rust.
- Kill the child process tree on tab close and application exit: process groups on Unix and job objects on Windows.
- Redact secrets, auth files, environment values, and prompt content from production logs by default.
- Treat rendered Markdown and tool HTML as untrusted; disable raw HTML and external navigation without confirmation.

## 7. Delivery milestones

### M0: protocol and design baseline

- Initialize repository, toolchain, CI, formatting, linting, and test commands.
- Capture Pi RPC fixtures and document supported Pi version/capabilities.
- Produce desktop and narrow-window wireframes plus semantic color/type tokens.
- Record architecture, security, and session-source-of-truth decisions.

Acceptance: protocol fixture tests pass; visual plan covers empty, streaming, tool, permission, error, and narrow-window states; no production UI work depends on guessed raw events.

### M1: native transport vertical slice

- Build Tauri process registry, CLI discovery, typed bridge, request correlation, generation filtering, and clean process-tree shutdown.
- Display raw diagnostic events for one newly created and one resumed session.

Acceptance: prompt/abort/resume survives rapid tab switching; stale events cannot enter the active session; missing/incompatible Pi produces an actionable screen.

### M2: chat core

- Implement timeline, Markdown/code, activity rail, tool states, composer, model/thinking controls, auto-scroll, error and reconnect states.
- Implement extension UI confirm/select/input/editor and background notifications.

Acceptance: captured fixture scenarios and a live Pi prompt render consistently; keyboard-only send, stop, inspect, answer, and retry flows work.

### M3: workspace shell

- Implement project/session rail, tabs, session browser, fork/rename/delete, right file/diff inspector, persisted layout and unread state.

Acceptance: three simultaneous sessions across two projects remain isolated through restart and rapid switching; tool file links open the correct workspace file.

### M4: terminal, security, and settings

- Add real PTY resize/input/output, project cwd, settings, theme, command palette, permission boundaries, and failure recovery.

Acceptance: terminal programs behave interactively; path traversal and symlink escape tests fail closed; settings survive relaunch.

### M5: release candidate

- Accessibility, performance, responsive/narrow window pass, crash recovery, packaging, screenshots, and release smoke tests.

Acceptance: typecheck, lint, unit, integration, Rust, and E2E suites pass; signed or clearly documented unsigned artifacts build for macOS, Windows, and Linux; no known P0/P1 defects.

## 8. Test strategy

- Rust unit tests: session parsing, path sandbox, symlink escapes, executable discovery, process registry, shutdown.
- TypeScript unit tests: Pi adapter fixtures, event ordering/deduplication, store reducers, command capability gating.
- Component tests: composer, activity disclosures, extension UI, errors, keyboard focus, pane resizing.
- Integration tests: fake JSONL Pi child process for timeout, malformed line, crash, reconnect, stale generation, and concurrent sessions.
- Playwright desktop tests: first run, open project, send/stop prompt, answer UI request, inspect file/diff, terminal, resume after relaunch.
- Visual checks at 1440x900, 1024x768, 768x800, and a narrow desktop window; verify no overlap, clipped labels, blank panels, or unstable layout.
- Platform smoke: latest macOS plus one supported Windows and Linux environment for install, Pi discovery, PTY, notifications, and process cleanup.

## 9. Main risks

- Pi RPC drift: contain it in one adapter, probe capabilities, pin a tested range, and retain fixtures.
- Concurrent runtime races: generation and sequence filtering plus process-tree tests are release gates.
- Scope growth from OpenChamber parity: parity means matching the selected workflows, not its full platform surface.
- Tauri permission breadth: security tests and capability review are required before release.
- Full PTY portability: validate all three platforms during M4 rather than substituting a command-output widget.
- Large React/store modules: enforce feature boundaries and keep transport, normalization, state, and rendering separate.

## 10. Definition of done for v0.1

A user can install Pichamber, locate or configure Pi, open a project, run and resume multiple isolated sessions, understand streaming and tool activity, answer extension requests, inspect affected files and diffs, use an interactive terminal, recover from process failure, and relaunch without losing shell context. These workflows must pass automated critical-path tests and platform smoke checks.
