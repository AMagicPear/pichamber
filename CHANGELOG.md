# Changelog

All notable changes to this project are documented in this file.

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
