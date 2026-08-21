/**
 * 服务端自身（pichamber server）的 wire 类型：全局设置与版本信息。
 */

/** Response body for GET /api/version. */
export type VersionInfo = {
  /** The pi coding-agent version the server embeds. */
  pi: string;
};

/** Server-wide runtime settings (persisted on disk by the server).
 *  Currently only carries the optional external `pi` executable path;
 *  new fields land here when the server needs to remember a choice that
 *  outlives the client process. */
export type ServerSettings = {
  /** When true, new sessions are launched by spawning an external
   *  `pi --mode rpc` subprocess instead of using the bundled SDK.
   *  Toggling this only affects sessions opened after the change —
   *  existing sessions keep their original runtime. */
  useExternalPi: boolean;
  /** Path to the external `pi` binary. Absolute or `$PATH`-resolvable.
   *  Empty means "use whatever `pi` resolves to on $PATH". */
  externalPiPath: string;
  /** Diagnostic snapshot of the external `pi` resolver. Returned by
   *  GET/PUT `/api/settings/server` so the Settings UI can show the
   *  absolute path the server will actually spawn (and surface a clear
   *  hint when the binary isn't on PATH). */
  externalPi: {
    /** Echo of the toggle, redundant with `useExternalPi` for clarity. */
    configured: boolean;
    /** The path string the user typed (after trimming). Empty when
     *  the field was left blank. */
    rawPath: string;
    /** Absolute path to the resolved binary, or `null` when no match
     *  was found. The Settings UI mirrors this in the placeholder. */
    resolved: string | null;
  };
};
