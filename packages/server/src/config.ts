/**
 * Process-level configuration read once from the environment.
 *
 * Imported by both the server entry (`index.ts`) and the route modules so
 * they agree on the bind address, reported version, and daemon token without
 * threading a config object through every factory.
 */
const rawPort = Number(process.env.PICHAMBER_PORT || 3000);
if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65_535) {
  throw new Error(`Invalid PICHAMBER_PORT: ${process.env.PICHAMBER_PORT}`);
}

export const hostname = process.env.PICHAMBER_HOST || "127.0.0.1";
export const configuredPort = rawPort;
export const version = process.env.PICHAMBER_VERSION || "dev";
export const instanceId = process.env.PICHAMBER_INSTANCE_ID;
export const daemonToken = process.env.PICHAMBER_DAEMON_TOKEN;
export const startedAt = new Date().toISOString();
