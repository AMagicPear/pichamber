// Vendored stub. OpenChamber's `lib/desktop` carries desktop/VSCode/Electron
// detection helpers. The markdown renderer only needs `isVSCodeRuntime()` to
// pick a tighter syntax-highlight line limit on VSCode's webview; everything
// else is unused on Pichamber's browser-first runtime.

export const isDesktopShell = (): boolean => false;
export const isDesktopLocalOriginActive = (): boolean => false;
export const isVSCodeRuntime = (): boolean => false;