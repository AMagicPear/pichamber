# Oh My Pi SDK Compatibility Requirements

## Status

This document defines the technical requirements for adding Oh My Pi (OMP) as
an embedded SDK runtime to pichamber. It is an architecture and acceptance
contract, not an implementation proposal. It applies to OMP `18.x` and the
currently bundled Pi SDK independently.

The implementation must follow `AGENTS.md`:

- Reuse public SDK types, factories, and services. Do not reproduce SDK
  behavior by parsing CLI output or reimplementing session/model logic.
- Keep the smallest coherent ownership boundary. Refactor shared behavior into
  one component rather than adding separate Pi and OMP versions of a feature.
- Prefer deleting Pi-0.84-specific abstractions to preserving them through
  compatibility branches.
- Use pichamber-owned types only at the browser transport boundary; retain
  original SDK values within each runtime adapter.

## Product Scope

### Required outcome

The Runtime setting must support three execution backends:

| Backend | Runtime | Purpose |
| --- | --- | --- |
| `pi-sdk` | Bundled `@earendil-works/pi-coding-agent` SDK | Existing embedded Pi behavior. |
| `omp-sdk` | Bundled `@oh-my-pi/pi-coding-agent` SDK | Embedded OMP behavior. |
| `pi-rpc` | Pi CLI RPC subprocess | Existing process-isolation and compatibility mode. |

`pi-sdk` remains the default until `omp-sdk` passes the core-parity acceptance
suite. `pi-rpc` must not be presented as OMP compatibility; OMP is supported
through its SDK adapter, not by sending Pi RPC frames to `omp`.

### Core parity definition

OMP core parity means that a user can perform the following without a terminal
TUI and without SDK-specific breakage:

1. Create, open, list, rename, delete, fork, and copy OMP sessions.
2. Send text and image prompts, stream assistant messages and tool execution,
   queue steering/follow-up messages, restore cancelled queued input, abort,
   and compact.
3. Select an available model and its supported thinking setting.
4. Inspect current context, token/cost statistics, tools, extensions, skills,
   and supported provider configuration.
5. Use browser-supported extension dialogs, notifications, status entries, and
   string-line widgets.
6. Reload runtime resources after supported configuration changes.
7. Reconnect a browser and reconstruct the session view from one authoritative
   snapshot.

OMP-specific TUI surfaces are explicitly out of scope for core parity: custom
TUI component factories, terminal input handlers, editor component factories,
autocomplete providers, themes, terminal headers/footers, computer/browser
control UI, plan/goal/vibe workflow UI, memory administration, and complete
subagent orchestration UI. They may be added only through separately approved
browser product requirements.

### Explicit non-goals

- Do not make one OMP session readable or writable by the Pi 0.84 SDK.
- Do not promise that existing Pi JSONL sessions can be resumed in OMP, or the
  reverse, without a tested migration design.
- Do not import OMP implementation files or copy code from the installed CLI;
  depend on the published public packages and declarations.
- Do not maintain a fake generic `ModelRuntime`, `ResourceLoader`, or
  `SessionManager` that masks incompatible SDK semantics.
- Do not add browser controls for an OMP capability merely because the SDK
  exposes it.

## Dependency and Installation Requirements

1. Add exact, workspace-consistent `@oh-my-pi/pi-coding-agent`,
   `@oh-my-pi/pi-agent-core`, and `@oh-my-pi/pi-ai` dependencies where runtime
   imports require them. Resolve them from the lockfile, never from the
   developer's global Bun installation.
2. Pin all OMP packages to the same release line. OMP packages are tightly
   coupled; mixed major/minor versions are unsupported.
3. Keep Pi and OMP packages separately resolvable. No alias may cause an OMP
   class or type to be passed to a Pi SDK API, or vice versa.
4. Update the Bun server build's externals for all runtime-loaded OMP packages
   required by the selected production distribution strategy.
5. Make the runtime identity observable in diagnostics: package name, package
   version, backend id, and session storage root. Never include credentials or
   message contents.

## Target Architecture

### Ownership boundaries

```text
Pi SDK / OMP SDK / Pi RPC
        |
        v
RuntimeSessionAdapter (server-only; one adapter per runtime)
        |
        v
SessionChannel and normalized pichamber wire protocol
        |
        v
Vue transport, reducer, effects, and components
```

`RuntimeSessionAdapter` is the sole boundary between a concrete agent runtime
and pichamber. It owns only agent-runtime concerns:

- session lifecycle and persistence handles;
- prompt, queue, abort, compaction, model, and thinking operations;
- runtime event subscription and snapshot extraction;
- runtime resource discovery and supported reload;
- supported extension UI binding;
- provider/settings capabilities required by the pichamber settings pages.

Files, Git, PTY, workspace filesystem, diagnostics storage, and browser UI
remain pichamber services and must not branch on runtime identity.

### Adapter shape

Replace `SdkSessionDriver` with a single runtime-neutral adapter contract.
`PiSdkSessionAdapter`, `OmpSdkSessionAdapter`, and `PiRpcSessionAdapter` are
the only implementations. The public contract must expose facts and commands,
not raw SDK instances:

```ts
type RuntimeKind = "pi-sdk" | "omp-sdk" | "pi-rpc";

interface RuntimeSessionAdapter {
  readonly kind: RuntimeKind;
  readonly sessionId: string;
  readonly cwd: string;
  readonly sessionFile?: string;

  start(): Promise<void>;
  dispose(): Promise<void>;
  abort(): Promise<void>;
  prompt(input: RuntimePrompt): Promise<RuntimePromptResult>;
  compact(instructions?: string): Promise<void>;
  setModel(selection: RuntimeModelSelection): Promise<void>;
  setThinking(selection: RuntimeThinkingSelection): Promise<void>;
  clearQueue(options?: { forInterrupt?: boolean }): RuntimeRestoredQueue;
  snapshot(): Promise<RuntimeSnapshot>;
  reload(): Promise<RuntimeReloadResult>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
}
```

This is intentionally a pichamber contract. It must not use structural casts
to claim that OMP `AgentSession`, Pi `AgentSession`, and RPC client state have
the same API. The implementation retains native session values privately and
uses direct SDK APIs inside each adapter.

Do not create parallel `OmpSessionDriver` and `PiSessionDriver` trees with
duplicated WebSocket, provider, settings, or UI code. Runtime-specific logic
belongs to the adapter; all shared server behavior consumes the contract.

### OMP adapter requirements

The OMP adapter must construct sessions using the public
`createAgentSession()` and `SessionManager` APIs from
`@oh-my-pi/pi-coding-agent`.

It must retain the full creation result, not only `session`:

- `AgentSession` owns agent lifecycle, queues, compaction, state, and events.
- `SessionManager` owns OMP session storage, session entries, artifacts, and
  lazy durable materialization.
- `ModelRegistry` is accessed through `session.modelRegistry` for model and
  provider metadata.
- `Settings` is accessed through `session.settings` for configured OMP
  behavior.
- `extensionsResult` and the session's native tool/resource APIs own extension
  and tool inventory.

OMP `SessionManager.open`, `forkFrom`, `list`, `listAll`, and similar methods
are asynchronous. Every pichamber session-registry operation must be async
end-to-end; do not conceal promises with synchronous wrappers or start an
operation before its manager has been opened.

`sessionFile` is optional in OMP. The adapter and UI must handle a new,
not-yet-materialized session. A feature requiring a persistent file must call
the public OMP persistence mechanism, or report that the action is unavailable;
it must not construct a path and assume the file exists.

## Wire Protocol and State Requirements

### Stable browser contract

The WebSocket protocol is pichamber's public boundary. It must not carry
`AgentSessionEvent`, `JsonAgentSessionEvent`, `AgentMessage`, or extension UI
unions imported directly from either SDK.

Replace direct SDK re-exports in `packages/shared/src/index.ts` and
`packages/shared/src/session.ts` with pichamber-owned, serializable wire
types. They must describe only data that the browser renders or sends:

- normalized transcript messages and incremental message updates;
- tool execution state and result display data;
- activity, retry, compaction, and queue state;
- selected/available model descriptors and thinking choices;
- context/statistics view data;
- discovered resources and their supported actions;
- browser-supported extension UI requests and responses;
- explicit capability flags for conditional UI.

The adapter converts native SDK values to these types at the server boundary.
It must preserve unknown message fields in a namespaced `details` payload only
when the existing renderer can safely ignore them. Do not stringify opaque
objects into transcript content.

### Event normalization

`SessionChannel` remains the only producer of browser session frames;
`useConversationSession` remains the only WebSocket consumer; the session store
remains the only ordered state reducer.

Each adapter must map native events to a closed pichamber `RuntimeEvent`
vocabulary. At minimum it must cover:

| Browser event category | Pi SDK source | OMP source |
| --- | --- | --- |
| Message/stream updates | Pi session events | OMP `AgentSessionEvent` / core agent events |
| Agent lifecycle | `agent_start`, `agent_end` | `agent_start`, `agent_end` with terminal semantics |
| Tool lifecycle | tool execution events | core agent tool events |
| Compaction | manual/auto compaction events | manual plus `auto_compaction_start/end` |
| Retry | retry events | `auto_retry_start/end`, fallback events |
| Queue | queue updates | session queue accessors and prompt lifecycle |
| Model/thinking | model/thinking events | `model_changed`, `thinking_level_changed` |
| Runtime notice | SDK error/status events | OMP `notice` and supported state changes |

The reducer must not infer a model switch, completion, queue delivery, or
durable state from a DOM action. The server snapshot and sequenced event stream
remain authoritative.

Snapshots must include all information necessary to render the current session
after reconnect. A sequence gap still requires an explicit resync. Unsequenced
dialogs, notifications, editor replacements, and transient errors remain
out-of-band and must never be replayed as durable state.

### Required change to event architecture

`docs/session-event-architecture.md` must be revised during implementation.
Its current requirement to forward SDK event unions verbatim applies only to a
single SDK and conflicts with OMP support. Retain its ownership, sequencing,
snapshot, reducer, and side-effect rules, but replace direct event passing with
the normalized adapter event contract specified here.

## Session and Transcript Requirements

1. Treat Pi and OMP session storage as separate namespaces. Session list rows
   must expose the owning `runtimeKind` and storage provenance.
2. Listing, opening, deleting, renaming, forking, and copying must invoke each
   runtime's public session manager. No code may parse or rewrite foreign
   session JSONL as a shortcut.
3. Session sidebar grouping must include the runtime kind when identical paths
   or ids can coexist. A user must never open an OMP file with the Pi adapter.
4. The fork/copy UI must only enable operations the selected runtime confirms
   it can perform. OMP's artifact handling must use its public APIs.
5. Message-entry identifiers are runtime-local. Browser fork controls must pass
   opaque entry identifiers back to the same adapter, never assume Pi entry
   layout or message-to-entry alignment.
6. Snapshot construction must use the native runtime's public display/context
   APIs. In particular, OMP should use its session context/transcript and stats
   APIs rather than Pi's `buildContextEntries` or `getLastAssistantUsage`.

## Models, Providers, and Settings Requirements

### Model capability facade

Introduce one server-only `RuntimeConfigurationAdapter` owned by the selected
runtime adapter. It exposes pichamber's minimum UI needs:

- available models and the current model;
- provider id, display name, API family, base URL when public and safe, and
  model count;
- provider authentication configuration status;
- supported thinking selections;
- supported behavior settings and their current values;
- explicit capabilities for unsupported settings/actions.

For OMP, use `session.modelRegistry` and `session.settings`; do not emulate Pi
`ModelRuntime` or `SettingsManager`. OMP provider identity may be model-derived
rather than a first-class provider object, so provider list output must be
derived once on the server from the public registry and reused by all endpoints.

Existing provider quota code is Pi-specific. It must become either:

1. a runtime capability with a Pi implementation and an explicit OMP
   `unsupported` result; or
2. a provider-neutral service with OMP support demonstrated against public OMP
   APIs.

It must not read OMP credential internals or assume an API key is available in
memory. The UI must hide unavailable quota actions rather than showing a
nonfunctional control.

### Settings ownership

The existing `PiBehaviorSettings` API must become a named pichamber behavior
surface with per-field support metadata. A settings view renders only a setting
that the active runtime supports and confirms as writable.

Setting changes must use the native manager's persistence API and await its
durability boundary before returning success. OMP settings must not be written
as Pi JSON merely to retain the present UI.

## Extensions, Skills, MCP, and UI Requirements

### Resource inventory and reload

Resource discovery is adapter-owned. The shared resource model contains only:

- commands visible to pichamber;
- active and discoverable tools, with source provenance;
- loaded extension source paths and diagnostics;
- loaded skills and warnings;
- explicit reloadability and support capabilities.

For OMP, build this from `createAgentSession()`'s `extensionsResult`, the
session's public tool metadata methods, public skill accessors, and OMP reload
APIs. Do not fabricate a Pi `resourceLoader` object.

The extension installation/update page currently depends on Pi's
`DefaultPackageManager`. It must be redesigned before OMP support is advertised:

- retain it as a Pi-only capability, clearly scoped by backend; or
- replace it with an OMP-supported plugin/configuration workflow using a public
  OMP API or controlled subprocess command with a documented lifecycle.

The page must not show Pi package operations while an OMP runtime is active.

### Browser extension UI

Create one pichamber browser extension-UI facade that implements the supported
subset of each runtime's public `ExtensionUIContext` contract:

- select, confirm, input, and editor dialogs;
- notifications and status values;
- editor text replacement;
- line-based widgets with known placements;
- browser title updates.

Every unsupported extension UI method must have a deliberate behavior:

- return the documented default/cancelled value for interactive requests;
- reject unsupported configuration changes with a readable capability error;
- omit component-only renderers from resource claims.

Do not silently accept custom component factories, terminal handlers, theme
changes, or autocomplete providers. Their results cannot be faithfully rendered
in the browser and pretending otherwise creates nondeterministic extension
behavior.

The facade may share protocol code, but must use each SDK's native context type
inside its adapter. Never cast OMP UI context to Pi UI context.

### Bundled extensions

Every bundled extension must be classified before OMP core parity ships:

- portable without changes;
- portable after import/API migration;
- Pi-only; or
- replaced by a pichamber feature.

`pi-apply-patch` and `ark-agent-plan` must not be assumed portable because OMP
offers a legacy extension shim. Build and runtime tests must prove their
required tools, events, UI calls, and persisted data work under OMP.

## Refactoring Requirements by Module

| Area | Current coupling | Required result |
| --- | --- | --- |
| `packages/server/src/core/driver.ts` | Pi `AgentSessionRuntime`, `modelRuntime`, Pi RPC types | Runtime-neutral adapter contract and three focused implementations. |
| `packages/server/src/core/session.ts` | Pi runtime factory and synchronous session-manager assumptions | Runtime-aware async registry with native session managers. |
| `packages/server/src/core/context.ts` | Pi context-entry and usage helpers | Adapter-provided normalized stats/transcript snapshot. |
| `packages/server/src/core/ws.ts` | Raw SDK events, Pi resource loader, Pi extension binding | Normalized events and adapter-owned resources/UI binding. |
| `packages/server/src/providers/*` | Pi `ModelRuntime` provider objects | Capability facade; preserve only provider-neutral code. |
| `packages/server/src/settings/pi-config.ts` | Pi settings/auth methods | Runtime configuration adapter and capability-aware endpoints. |
| `packages/server/src/extensions/*` | Pi package manager and Pi UI context | Shared supported browser facade plus backend-specific source management. |
| `packages/shared/src/*` | SDK event/type re-exports | Stable pichamber wire definitions only. |
| `packages/web/src/*` | Pi SDK type imports and event vocabulary | Consume only shared wire types and capability data. |
| bundled extensions | Pi package scopes/APIs | Explicit portability decision and tests. |

The refactor must delete the old `SessionDriver` API as soon as the unified
adapter supersedes it. Do not leave an alias layer carrying obsolete names such
as `SdkSessionDriver` or Pi-specific `getSdkSession` throughout the codebase.

## Delivery Phases and Acceptance Criteria

### Phase 0: Compile and lifecycle spike

- OMP dependencies resolve from a clean `bun install`.
- A server test creates an OMP session in a temporary cwd, sends a prompt using
  a controlled fake provider/tool configuration, receives a streamed event,
  aborts or completes, and disposes.
- No application code imports both Pi and OMP nominal runtime values in the
  same adapter implementation.

### Phase 1: Runtime core

- Backend selection can create `pi-sdk`, `omp-sdk`, and `pi-rpc` adapters.
- OMP supports prompt, image prompt, abort, compaction, queue restoration,
  model switch, thinking selection, snapshot, reconnect, and dispose.
- New OMP sessions remain valid before their session file is materialized.
- All session registry operations are correctly awaited.

### Phase 2: Protocol migration

- Shared and web packages contain no direct imports from either coding-agent
  package for browser session events, messages, or extension UI frames.
- Reducer tests prove Pi SDK and OMP event traces lead to the same pichamber
  state for common workflows.
- A reconnect snapshot reconstructs both runtime views without relying on
  previous browser state.

### Phase 3: Configuration and resources

- Model/settings pages use capabilities and show no unsupported actions.
- Resource list, skill list, reload, and supported extension UI work for OMP.
- Pi-specific extension package management is either visibly Pi-only or has a
  tested OMP replacement.

### Phase 4: Session operations and extensions

- List/open/rename/delete/fork/copy are tested with OMP's native manager.
- Existing Pi sessions remain usable through `pi-sdk` and `pi-rpc`.
- Bundled extensions have portability decisions and test coverage.
- Diagnostics distinguish adapter failures from extension failures and storage
  failures.

### Required verification

At minimum, run:

```sh
bun run type-check
bun run test
bun run build
```

Add focused server tests for each adapter and session operation, shared reducer
fixtures for normalized traces, and browser tests for reconnect, model/thinking
controls, capability hiding, streaming tool messages, and extension dialogs.
Test with a real OMP package installed by the project lockfile; mock only
provider network traffic and unsafe external tools.

## Completion Gate

OMP SDK compatibility is complete only when all core-parity behaviors work on a
clean installation, the required verification passes, the runtime choice is
visible in diagnostics, and unsupported OMP capabilities are absent or clearly
identified in the UI. A successful `createAgentSession()` call alone is not
compatibility.
