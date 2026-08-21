/**
 * 终端（PTY）的 wire 类型（pichamber 自有功能）。
 */

/** Request body for POST /api/pty/start. */
export type PtyStartOptions = {
  /** Session whose working directory owns this terminal. */
  sessionId?: string;
  cols: number;
  rows: number;
};

/** Response body for POST /api/pty/start. */
export type PtyStartResult = {
  ptyId: string;
  shell: string;
  cwd: string;
  /** Display title (`~`, `~/projects/foo`, or full path). Server computes
   *  this from the cwd so the client never duplicates the `~/` collapsing. */
  title: string;
};
