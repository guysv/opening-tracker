const PORT = Number(process.env.OT_DEV_PORT) || 3200;
const HOST = process.env.OT_DEV_HOST;

/** Dev-only client logging (see `.cursor/skills/mobile-debug`). */
const corsDevLog = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const server = Bun.serve({
  port: PORT,
  ...(HOST ? { hostname: HOST } : {}),
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/__reload") {
      return new Response(
        new ReadableStream({
          start(controller) {
            const id = setInterval(() => {
              // Keep the SSE connection alive without triggering onmessage handlers.
              controller.enqueue(`event: ping\ndata: keepalive\n\n`);
            }, 1000);
            req.signal.addEventListener("abort", () => clearInterval(id));
          },
        }),
        { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
      );
    }

    if (url.pathname === "/__dev/log") {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsDevLog });
      }
      if (req.method === "POST") {
        try {
          const ct = req.headers.get("Content-Type") ?? "";
          const ua = req.headers.get("User-Agent") ?? "";
          const raw = await req.text();
          const iso = new Date().toISOString();
          let line = `[__dev/log] ${iso} ua=${JSON.stringify(ua.slice(0, 120))}`;
          if (ct.includes("application/json")) {
            try {
              line += ` ${JSON.stringify(JSON.parse(raw))}`;
            } catch {
              line += ` json-parse-fail ${raw.slice(0, 8000)}`;
            }
          } else {
            line += ` ${raw.slice(0, 8000)}`;
          }
          console.log(line);
        } catch (e) {
          console.warn("[__dev/log] handler:", e instanceof Error ? e.message : String(e));
        }
        return new Response(null, { status: 204, headers: corsDevLog });
      }
      return new Response("Method not allowed", { status: 405, headers: corsDevLog });
    }

    const result = await Bun.build({
      entrypoints: [
        "src/index.html",
        "src/workers/gameImport.worker.ts",
        "src/workers/gameParse.worker.ts",
        "src/workers/db.worker.ts",
      ],
      outdir: "dist",
      sourcemap: "inline",
    });

    if (!result.success) {
      const errors = result.logs.map((l) => l.message ?? String(l)).join("\n");
      return new Response(`<pre style="color:red">${Bun.escapeHTML(errors)}</pre>`, {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (!(await Bun.file("dist/sqlite3/index.mjs").exists())) {
      const src = "node_modules/@sqlite.org/sqlite-wasm/dist";
      await Bun.write("dist/sqlite3/index.mjs", Bun.file(`${src}/index.mjs`));
      await Bun.write("dist/sqlite3/sqlite3.wasm", Bun.file(`${src}/sqlite3.wasm`));
    }

    if (!(await Bun.file("dist/stockfish/stockfish-18-lite-single.js").exists())) {
      const sf = "node_modules/stockfish/bin";
      await Bun.write("dist/stockfish/stockfish-18-lite-single.js", Bun.file(`${sf}/stockfish-18-lite-single.js`));
      await Bun.write("dist/stockfish/stockfish-18-lite-single.wasm", Bun.file(`${sf}/stockfish-18-lite-single.wasm`));
    }

    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`dist${path}`);

    if (await file.exists()) {
      let body: Response | string = new Response(file);

      if (path.endsWith(".html")) {
        const html = await file.text();
        const injected = html.replace(
          "</body>",
          `<script>new EventSource("/__reload").addEventListener("reload",()=>location.reload())</script></body>`,
        );
        body = new Response(injected, { headers: { "Content-Type": "text/html" } });
      }

      return body;
    }

    const isAssetRequest =
      path.includes(".") ||
      path.startsWith("/workers/") ||
      path.startsWith("/chunk-") ||
      path.startsWith("/index-") ||
      path.startsWith("/stockfish/");

    if (isAssetRequest) {
      return new Response("Not found", { status: 404 });
    }

    const index = Bun.file("dist/index.html");
    if (await index.exists()) {
      const html = await index.text();
      const injected = html.replace(
        "</body>",
        `<script>new EventSource("/__reload").addEventListener("reload",()=>location.reload())</script></body>`,
      );
      return new Response(injected, { headers: { "Content-Type": "text/html" } });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(
  HOST
    ? `Dev server running at http://${HOST}:${PORT}`
    : `Dev server running at http://localhost:${PORT}`,
);
