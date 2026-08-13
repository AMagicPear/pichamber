# Architecture decisions

## Remote hosts

The supported remote shape is a complete pichamber backend on the target host:

```text
local browser
  -> SSH local port forwarding
  -> remote pichamber backend on 127.0.0.1
  -> Pi AgentSession SDK
  -> remote files, Git, PTY, Pi config, and sessions
```

The backend binds to loopback and is not a public network service. A future CLI
may install/start the remote backend and manage the SSH tunnel. Authentication
and encryption remain SSH's responsibility.

This keeps every cwd-bound capability on one host. Running only `pi --mode rpc`
over SSH would still require separate transports for the file tree, Git, PTY,
session listing, and Pi configuration.

## Pi runtimes

The default runtime is the bundled `@earendil-works/pi-coding-agent` SDK version
tested with the current pichamber release. This follows Pi's guidance for a
TypeScript application embedding Pi in the same process and gives pichamber a
reproducible, type-safe runtime.

A future external runtime may launch a user-installed `pi --mode rpc`. RPC is an
optional compatibility and process-isolation mode, not the default backend. It
must negotiate the Pi version and required commands before opening a session;
unsupported versions should fail explicitly rather than silently degrade.

The runtime abstraction should cover agent concerns only: prompts, events,
models, thinking level, session state, and extension UI. Files, Git, and PTY stay
backend services and must not depend on whether the agent uses SDK or RPC.
