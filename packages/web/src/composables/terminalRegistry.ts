type Cleanup = () => void;

const cleanups = new WeakMap<HTMLElement, Cleanup>();

/** Replace the resource currently attached to a terminal host. */
export const replaceTerminalCleanup = (host: HTMLElement, cleanup: Cleanup) => {
  cleanups.get(host)?.();
  cleanups.set(host, cleanup);
};

/** Remove a cleanup only if it still belongs to the caller. */
export const releaseTerminalCleanup = (host: HTMLElement, cleanup: Cleanup) => {
  if (cleanups.get(host) === cleanup) cleanups.delete(host);
};
