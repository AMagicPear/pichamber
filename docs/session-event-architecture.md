# Session Event Architecture

## Purpose

This document defines the browser session event chain. It prevents protocol
logic, durable state, and browser-only side effects from being mixed together.

## Data Flow

```text
Pi SDK or RPC runtime
  -> SessionChannel (server)
  -> WebSocket ServerMessage
  -> useConversationSession transport
  -> applyServerMessage reducer
  -> reactive session state
  -> Vue components
```

`packages/server/src/core/ws.ts` is the only producer of browser session
frames. `packages/web/src/composables/useConversationSession.ts` is the only
consumer of the session WebSocket. `packages/web/src/stores/session.ts` is the
only reducer for those frames.

## Direct Event Passing

The server forwards every official `AgentSessionEvent` / `JsonAgentSessionEvent`
verbatim through the socket (only `seq` is added). The browser reducer works
on the official Pi event vocabulary directly — it derives `activity` from
`agent_start` / `agent_settled` / `compaction_*` / `auto_retry_start`, `pending`
from `queue_update`, and `thinking.level` from `thinking_level_changed`. The
server never invents a parallel event shape.

The genuinely expensive derived state is still computed on Bun (server-side)
and pushed as compact `state` frames: the model inventory, thinking available
levels, session stats (`buildContextEntries` + formatting), extension/tool
resources, and the compaction-merged `pending` (a server-side buffer the
browser cannot derive). The browser only performs O(1) ref assignments for
state fields — it never recomputes heavy derivations.

## Message Classes

`SequencedServerMessage` contains snapshots, `state` frames, and official Pi
session events. It carries a monotonic `seq`; a gap must trigger `resync` and
must not partially mutate local session state.

`extension_ui_request`, `draft_restore`, and `error` are out-of-band commands.
They are intentionally not sequenced or replayed as session state. Durable
extension setters are replayed separately by the server; dialogs and
notifications are not replayed.

## State, Events, and Effects

- `workspace.ts` owns project and selected-session metadata only.
- `session.ts` owns current session state and derived values only. It stores no
  last/raw event and exposes no browser API calls (no DOM, timers, network, or
  notifications — those belong to effects).
- `sessionEffects.ts` performs browser-only effects returned by the reducer:
  error toast, completion sound/notification, session-list refresh, and
  document title wiring.
- `extensionUi.ts` owns extension dialog, notification, status, and widget
  state. It accepts only official extension UI request shapes.
- Components read reactive state and emit only local parent-child interaction.
  They do not switch on `ServerMessage` or subscribe to the WebSocket.

Use a `computed` value when a value can be derived from authoritative session
state. For example, the actual last assistant model is derived from the
conversation rather than separately synchronized during snapshot, event, and
reset paths.

## Rules For New Behavior

1. Reuse Pi SDK event and message types. Do not introduce a parallel browser
   event vocabulary merely to make rendering convenient.
2. Add a server `state` field only for a durable, current fact that cannot be
   derived from existing messages/state. Add it to snapshot and reset behavior
   at the same time.
3. Add official event reduction in `session.ts`; keep it deterministic and free
   of DOM, timers, notifications, and network calls.
4. Return a `SessionEffect` for one-shot browser behavior and implement it in
   `sessionEffects.ts`. Do not make components watch an untyped latest event.
5. Preserve the snapshot and sequence-gap contract in a focused reducer test.
6. Keep ordinary Vue `watch`, DOM listeners, and component `emit` local when
   they describe local UI lifecycle. They are not candidates for a global bus.

## Invariants

- A reconnect snapshot is sufficient to reconstruct all durable session UI.
- An out-of-order ordered frame cannot mutate session state.
- A transition from non-idle activity to idle produces exactly one settlement
  effect, independent of whether it arrives in a snapshot or in the official
  `agent_settled` / `compaction_end` event.
- The browser never invents model, thinking, queue, or activity confirmation;
  the server remains authoritative.
