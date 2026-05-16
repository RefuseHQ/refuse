import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node20",
  // better-sqlite3 ships native bindings; keep it external so the prebuilt
  // .node lives under the runtime's node_modules instead of inside the bundle.
  external: ["better-sqlite3"],
  // Workspace packages don't compile to JS on their own — bundle them in so
  // Node ESM doesn't try to resolve `.ts` files at runtime.
  noExternal: [/^@refuse\//],
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  shims: false,
});
