import { createRequire } from "node:module";
import { run } from "vue-tsc";

const require = createRequire(import.meta.url);
const tscPath = require.resolve("typescript6/lib/tsc");

run(tscPath);
