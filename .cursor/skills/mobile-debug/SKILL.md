---
name: mobile-debug
description: Use POST /__dev/log (already implemented in this repo’s serve.dev.ts) from browser code so logs print on the dev PC terminal, or add the route in serve.dev.ts only if missing. Use for phones/tablets, remote devices, or where DevTools is unavailable; when the user asks for mobile logging, remote console, or fetch-to-PC logging in development.
---

# Mobile debug: `POST /__dev/log`

## This repository: server already wired

**`serve.dev.ts` already defines `/__dev/log`** (see `if (url.pathname === "/__dev/log")` **before** `Bun.build`): `OPTIONS` + `POST`, CORS headers, JSON or truncated plain body, lines prefixed with **`[__dev/log]`**, **`204`** on success.

For work in **this** codebase you usually **do not need to add or modify** that handler unless the user wants different behavior (GET ping, persistence, stricter errors, etc.). **Default action:** add or adjust **client** `fetch("/__dev/log", …)` (or `${location.origin}/__dev/log`) where you need visibility.

If you are applying this skill to **another** project that has no such route, implement the server section below in its Bun/Node dev server only.

## Goal

Client code calls **`fetch("http://<dev-host>:<port>/__dev/log", …)`** (same origin as the app when served by `serve.dev.ts`) so logs and structured data appear in the **terminal** on the PC running the dev server—for example a phone on the LAN using `http://192.168.x.x:3200/__dev/log`.

**Canonical path:** always **`/__dev/log`** (leading slash, under the dev server root). Do not invent a different path unless the user explicitly asks.

## Constraints

- Implement **`/__dev/log` only** in `serve.dev.ts` (Bun dev server). Do **not** add it to production builds, `build.ts`, or static hosting.
- Register **`/__dev/log` before** `Bun.build(...)` in the `fetch` handler, same as `/__reload`. Otherwise every log request triggers a full bundle rebuild.
- Keep the **`/__dev/log` handler** cheap: read body, print one line, return a small response. No persistence unless the user explicitly asks.

## Server: `serve.dev.ts` → `/__dev/log`

1. **Path** — Match exactly **`pathname === "/__dev/log"`** (no trailing slash required in the matcher; normalize if you support both).

2. **CORS** — `POST` with `Content-Type: application/json` may trigger a preflight. For **`/__dev/log`**, respond to **`OPTIONS`** with:
   - `Access-Control-Allow-Origin: *` (acceptable for local dev-only logging)
   - `Access-Control-Allow-Methods: POST, OPTIONS`
   - `Access-Control-Allow-Headers: Content-Type`  
   Same-origin loads from `http://<host>:<port>/` often skip preflight; CORS still helps for tunnels or odd setups.

3. **`POST /__dev/log`** — Accept:
   - `Content-Type: application/json` — parse JSON; print one terminal line (`JSON.stringify` or compact form).
   - `text/plain` — print the raw body (truncate very long bodies if needed, e.g. first 8k chars).
   - Unknown type — optional fallback: treat as text or log a short notice.

4. **Logging** — Prefix every printed line with **`[__dev/log]`** plus an ISO timestamp. Optionally append a short `User-Agent` snippet for grep-friendly sessions.

5. **Response** — Return **`204 No Content`** or **`200`** with `{ "ok": true }` and `Content-Type: application/json`. Keep payloads tiny.

6. **Errors** — On body parse errors, log a one-line warning and still return **`200`/`204`** so client `fetch` to **`/__dev/log`** does not spam failures during debugging (unless the user wants strict semantics).

## Client: calling `/__dev/log`

Same origin (typical when the app is served from the dev server)—path is always **`/__dev/log`**:

```ts
function devLog(payload: unknown) {
  void fetch("/__dev/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      t: new Date().toISOString(),
      payload,
    }),
    keepalive: true,
  });
}
```

If the base URL might not be the dev server root (unusual), use an absolute URL while keeping the path **`/__dev/log`**:

```ts
const url = `${location.origin}/__dev/log`;
void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true });
```

For navigation/unload, `keepalive: true` helps; **`navigator.sendBeacon`** with a `Blob` and `type: application/json` targeting **`/__dev/log`** is an alternative if `fetch` is unreliable.

## Optional extensions (only if requested)

- **GET** one-liners on the same path, e.g. **`/__dev/log?msg=...`** (still register **before** `Bun.build`).
- **Rate limit** or **auth token** query param on **`/__dev/log`** if the dev server is exposed beyond a trusted LAN.

## Verification

- Run the dev server, open the app from another device or tab, trigger a **`POST /__dev/log`** (e.g. `devLog(...)`), confirm **`[__dev/log]`** lines in the server terminal.
