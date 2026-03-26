# opening-tracker

Track and explore chess openings from your games.

## Development

```bash
bun install
bun run dev
```

## Build

```bash
bun run check
bun run build
```

Output is written to `dist/`.

## Cloudflare Pages

This app needs **cross-origin isolation** for sqlite-wasm + OPFS (`SharedArrayBuffer`). Cloudflare Pages can send the right headers via a root `_headers` file (copied into `dist/` by the build): `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy: credentialless` — see [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/).

**Dashboard:** Create a Pages project → connect the repo or use Direct Upload. **Build command:** `bun install && bun run build` · **Build output directory:** `dist`. Override **Bun** with `BUN_VERSION` if needed — see [Pages build image](https://developers.cloudflare.com/pages/configuration/build-image/).

**CLI (after `bun run cf:login`):**

```bash
bun run cf:pages:deploy -- --project-name=YOUR_PROJECT_NAME
```

Create the project first if required: `wrangler pages project create YOUR_PROJECT_NAME`.

