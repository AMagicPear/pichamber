# Apply Patch

Codex-style patch editing for Pi. GPT models use `apply_patch` in place of `edit`
and `write`. The tool accepts a raw patch or `{ "input": "..." }` when the host
uses JSON tool arguments.

```diff
*** Begin Patch
*** Update File: src/example.ts
@@ const example = () => {
-  return "before";
+  return "after";
 }
*** End Patch
```

## Matching

- Separate update blocks with `@@`. `@@ <existing source line>` is a search
  anchor, not a unified-diff line-number header. The first block may omit `@@`.
- Blocks match the original file in source order. Context must not overlap a
  previous block. Use enough context to distinguish repeated code; like Codex,
  matching chooses the first occurrence at the best available strictness.
- Matching tries exact text, trailing-whitespace tolerance, trimmed text, then
  normalized Unicode punctuation. Unchanged context retains its original bytes.
- A block containing only added lines appends at EOF, even after an anchor.
  `*** End of File` requires a match at EOF; a trailing empty context sentinel
  is tolerated. Empty `Add File` operations create zero-byte files.
- Existing line endings, BOM and unterminated final lines are preserved where
  possible. New lines use an available source terminator or the first file
  terminator (LF for an empty file). Unlike Codex's historical default, updates
  do not unconditionally append a final newline or normalize the file to LF.

## Writes and Failures

- Local writes use a temporary file in the destination directory followed by
  rename. Existing permission bits are retained; new move destinations inherit
  the source mode. Symlink updates write the referent and leave the link intact.
- Patch mutations use Pi's `withFileMutationQueue`, including both paths of a
  move. This coordinates with other Pi file tools, not external editors or
  other processes. Multi-file patches are not filesystem transactions.
- Like Codex, `Add File` can overwrite an existing file. Such overwrites are
  reported as updates. Move destinations can also be overwritten.
- The tool and `applyPatchDetailed` continue independent file actions after an
  error. `applyPatch` stops at the first error and throws `ApplyPatchError` with
  the committed changes. Cancellation prevents subsequent file writes.
- A move writes the destination before removing the source. If removal fails,
  the destination is recorded as committed and the source failure is reported.
  No automatic rollback is attempted. Retry only changes that have not landed.
- The extension's `tool_result` hook sets Pi's error flag for structured
  failures, retaining the partial changes for session persistence and rendering.
- Diff statistics and persisted update hunks come from Pi's official
  `generateUnifiedPatch`. Streaming previews are bounded; expanded final update
  diffs are complete and labeled by file.

Custom remote operations must implement the same atomic-write contract; they
are responsible for preserving remote metadata and cleaning up failed writes.

Matching and partial-move behavior follow the upstream Codex
[file updater](https://github.com/openai/codex/blob/main/codex-rs/apply-patch/src/file_update.rs)
and [committed-change tracking](https://github.com/openai/codex/blob/main/codex-rs/apply-patch/src/lib.rs).

## Development

From the repository root:

```sh
bun install
bun test packages/builtin-extensions/pi-apply-patch/src
bun run --filter @amagicpear/pichamber-builtin-apply-patch type-check
```

The bundled source does not update an already installed extension automatically.
Use Apply Patch's configuration action in pichamber to copy the updated source
and reload it. No runtime reload is performed by the tests.
