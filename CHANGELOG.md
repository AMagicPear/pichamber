# Changelog

All notable changes to this project are documented in this file.

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
