# Changelog

All notable changes to this project are documented in this file.

## [1.2.0] - 2026-09-08

### Added

- Bundled `apply_patch` tool upgraded to track upstream Codex conventions
  (improved failure semantics, atomic writes via `write-file-atomic`, and
  an expanded test suite).

### Changed

- Web design tokens centralised in `styles/tokens.css` — previously colors
  lived in `App.vue` and the `--ui-warning*` tokens were referenced but
  never declared.
- Server route table split out of `index.ts` (1132 → 165 lines): routes
  organised by domain (`routes/system.ts`, `sessions.ts`, `pi.ts`,
  `settings.ts`, `pty.ts`, `git.ts`, `fs.ts`, `diagnostics.ts`), with
  shared session resolution, error mapping, and the SDK-runtime guard
  centralised in `routes/http.ts`. Route paths and response behaviour
  unchanged (verified route-for-route across 51 paths).
- Sidebar session grouping / sort / search extracted into a
  `useSessionGroups()` composable with tests covering grandchild
  attribution, cross-project fork boundaries, Windows path grouping,
  search, and pagination. `SessionSidebar.vue` dropped from 1222 → 987
  lines.
- Shared `toMessage` helper moved into `@pichamber/shared` so the server
  and web consume the same conversion.
- Session stats now formatted in the active UI language instead of the
  runtime locale.
- CLI daemon / command boundary now strongly typed.
- File-tree shared styles extracted from `FileTree.vue` into
  `file-tree.css`, now reused by `FileTree.vue`, `FileTreeNode.tsx`,
  and `FileSearchResult.vue`.

### Fixed

- Server no longer leaks file descriptors in long-running sessions
  (was accumulating massive fd counts in the background).
- Dev-only `/debug` message-samples route was shipping in production;
  now gated behind `import.meta.env.DEV` and lazy-loaded so it is
  tree-shaken out.
- `cwdCompareKey` correctly decides Windows case-insensitivity from the
  host's path shape rather than the browser's `navigator.platform`.

### Documentation

- Documented intentional convention exceptions in `AGENTS.md`
  (`pi-apply-patch` upstream alignment, `ConversationMessages.vue`
  global styles, `file-tree.css` cross-component reuse).

## [1.1.3] - 2026-09-06

### Fixed

- Release: `npm publish` now ships the manifest produced by `bun pm pack`
  instead of the workspace manifest.

## [1.1.2] - 2026-09-06

### Fixed

- Release: catalogued dependencies (`@earendil-works/*`, `bun-pty`) are
  now published with the package instead of being stripped from the
  packed output.

## [1.1.1] - 2026-09-06

### Fixed

- Newly installed `pichamber` CLI was non-executable on first install
  (entry file lost its executable bit during packaging).
- Send-mode toggle in the conversation composer no longer drifts while
  the user drags across it; pointer-drag state now follows the toggle
  consistently.
- `<MarkdownImage>` prop type no longer resolves to an unresolved
  inference (`unknown`) when the image source is undefined.

## [1.1.0] - 2026-09-02

### Added

- Official extension marketplace in Settings → Extensions: browse, sort by
  downloads / recency, and install or uninstall third-party Pi extensions
  from the web UI.
- Session row menu: "Copy session ID" copies the underlying id to the
  clipboard for cross-tool use.
- Inline image rendering now supports SVG attachments.

### Changed

- Session and workspace flows reshaped:
  - Clicking a session whose cwd no longer exists opens the project picker
    (climbing to the nearest existing ancestor) instead of landing on a
    broken conversation screen.
  - ProjectPicker reworked with breadcrumb navigation and a dismissible
    "X 已不存在，已跳转到最近的已存在目录 Y" notice when the requested
    path was missing.
  - "复制到项目" menu action renamed to "创建分支会话".
  - Conversation rendering optimised: stream-diffs and message order are
    applied more eagerly so long sessions stay smooth.
  - Windows: cwd comparison is case-insensitive, so cross-project forks
    are attributed to the correct project even when `realpath` returns a
    different casing.
- Synced the embedded Pi SDK to v0.84.4.

### Fixed

- Thinking level not updating in the UI until the next manual change
  (model event was being dropped after the first selection).
- `bun run lint` clean: removed dead `processLogger` helper, unused
  `rename` import, and an unused `logger` instance in the I/O-error test.

## [1.0.1] - 2026-08-28

### Added

- Bundled the Codex-style `apply_patch` tool as an optional built-in extension.
- Included built-in extension source files in the published npm package.

### Changed

- Extended built-in extension installation to support multi-file extensions.
- Removed the standalone runtime dependency from the bundled `apply_patch`
  extension so it can be configured without a separate package install.

## [1.0.0] - 2026-08-27

### Added

- Browser workspace for Pi Coding Agent sessions, including terminal, files,
  Git, context, and conversation panels.
- Project, session, provider, runtime, extension, skill, and MCP management.
- Localized Chinese and English interface with configurable appearance and
  conversation preferences.
- Session search, project sorting, bulk session selection and deletion, and a
  keyboard shortcut reference.

### Changed

- Replaced the Vue release candidate dependency set with Vue 3.5 stable.

### Infrastructure

- Added CI verification and tag-triggered npm publishing workflows.

### Known limitations

- Forking a new conversation from an existing message is not yet implemented.

## [0.10.0] - 2026-08-22

- Previous prerelease baseline.
