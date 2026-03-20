import { $ } from "bun";

const startMs = performance.now();

await $`rm -rf dist`;

const result = await Bun.build({
  entrypoints: ["src/index.html", "src/workers/gameImport.worker.ts"],
  outdir: "dist",
  minify: true,
  splitting: true,
  sourcemap: "linked",
  // Stable worker filename so `new URL("../workers/gameImport.worker.js", import.meta.url)` matches dist (Bun does not rewrite Worker URLs to content hashes).
  naming: {
    entry: "[dir]/[name].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const elapsed = (performance.now() - startMs).toFixed(0);
console.log(`Build complete in ${elapsed}ms — ${result.outputs.length} files written to dist/`);
