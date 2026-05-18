import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  // Adds `#!/usr/bin/env node` so npm can run dist/index.js as a binary.
  banner: { js: "#!/usr/bin/env node" },
  // Inline our internal workspace packages into the output so the published
  // tarball doesn't depend on @ccc/* (which only exist inside this monorepo).
  noExternal: [/^@ccc\//],
});
