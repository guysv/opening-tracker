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

**GitHub Actions:** Pushing a version tag `v*` runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds, deploys **`dist`** to the Cloudflare Pages project **`opening-tracker`**, then publishes the GitHub Release. Add these repository **Secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|--------|
| `CLOUDFLARE_API_TOKEN` | API token with **Account → Cloudflare Pages → Edit** (and read account if prompted). See [CI/CD API token](https://developers.cloudflare.com/workers/wrangler/ci-cd/#api-token). |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → any domain → **Overview** right column, or Workers & Pages → your account id in the URL. |

