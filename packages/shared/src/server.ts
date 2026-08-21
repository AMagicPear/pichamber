/**
 * 服务端自身（pichamber server）的 wire 类型：版本信息。
 */

/** Response body for GET /api/version. */
export type VersionInfo = {
  /** The pi coding-agent version the server embeds. */
  pi: string;
};
