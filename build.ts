import { $ } from "bun";
import { resolve } from "path";

const startMs = performance.now();

await $`rm -rf dist`;

const result = await Bun.build({
  entrypoints: [
    "src/index.html",
    "src/workers/gameImport.worker.ts",
    "src/workers/gameParse.worker.ts",
    "src/workers/db.worker.ts",
  ],
  outdir: "dist",
  minify: true,
  splitting: true,
  sourcemap: "linked",
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

const sqliteDist = resolve("node_modules/@sqlite.org/sqlite-wasm/dist");
await $`mkdir -p dist/sqlite3 && cp ${sqliteDist}/index.mjs ${sqliteDist}/sqlite3.wasm dist/sqlite3/`;

const stockfishBin = resolve("node_modules/stockfish/bin");
await $`mkdir -p dist/stockfish && cp ${stockfishBin}/stockfish-18-lite-single.js ${stockfishBin}/stockfish-18-lite-single.wasm dist/stockfish/`;

const elapsed = (performance.now() - startMs).toFixed(0);
console.log(`Build complete in ${elapsed}ms — ${result.outputs.length} files written to dist/`);
