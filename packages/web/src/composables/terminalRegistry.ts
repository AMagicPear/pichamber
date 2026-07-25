type Cleanup = () => void;

const cleanups = new WeakMap<HTMLElement, Cleanup>();

/** Replace the resource currently attached to a terminal host. */
export function replaceTerminalCleanup(host: HTMLElement, cleanup: Cleanup): void {
  cleanups.get(host)?.();
  cleanups.set(host, cleanup);
}

/** Remove a cleanup only if it still belongs to the caller. */
export function releaseTerminalCleanup(host: HTMLElement, cleanup: Cleanup): void {
  if (cleanups.get(host) === cleanup) cleanups.delete(host);
}
