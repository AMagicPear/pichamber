// Vite-specific worker URL imports used by OpenChamber's vendored Shiki
// pipeline. The `?worker&url` suffix is handled by Vite at build time; we
// declare an ambient module shape here so TypeScript accepts the import.
declare module "*?worker&url" {
  const url: string;
  export default url;
}

declare module "*?worker" {
  const Worker: new () => Worker;
  export default Worker;
}