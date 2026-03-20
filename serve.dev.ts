const PORT = 3200;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/__reload") {
      return new Response(
        new ReadableStream({
          start(controller) {
            const id = setInterval(() => {
              controller.enqueue(`data: ping\n\n`);
            }, 1000);
            req.signal.addEventListener("abort", () => clearInterval(id));
          },
        }),
        { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
      );
    }

    const result = await Bun.build({
      entrypoints: ["src/index.html"],
      outdir: "dist",
      sourcemap: "inline",
    });

    if (!result.success) {
      const errors = result.logs.map((l) => l.message ?? String(l)).join("\n");
      return new Response(`<pre style="color:red">${Bun.escapeHTML(errors)}</pre>`, {
        headers: { "Content-Type": "text/html" },
      });
    }

    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`dist${path}`);

    if (await file.exists()) {
      let body: Response | string = new Response(file);

      if (path.endsWith(".html")) {
        const html = await file.text();
        const injected = html.replace(
          "</body>",
          `<script>new EventSource("/__reload").onmessage=()=>location.reload()</script></body>`,
        );
        body = new Response(injected, { headers: { "Content-Type": "text/html" } });
      }

      return body;
    }

    const index = Bun.file("dist/index.html");
    if (await index.exists()) {
      const html = await index.text();
      const injected = html.replace(
        "</body>",
        `<script>new EventSource("/__reload").onmessage=()=>location.reload()</script></body>`,
      );
      return new Response(injected, { headers: { "Content-Type": "text/html" } });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Dev server running at http://localhost:${PORT}`);
