# Changelog

All notable changes to this project will be documented in this file.

## 0.9.2

- **CI:** Release workflow no longer passes `GITHUB_TOKEN` to Wrangler (Cloudflare deploy only needs API token + account ID). Tagged release to verify Cloudflare Pages deploy with repo secrets.

## 0.9.1

- **Hosting:** Production deploy is **Cloudflare Pages** only. GitHub Pages is not used; disable it in the repo settings if it was previously enabled.
- **CI:** Releases (`v*` tags) continue to build, deploy `dist` to Cloudflare, and publish the GitHub Release artifact.

## 0.9.0

- Initial public release.
- Resolve worker scripts with `./workers/…` relative to the main bundle so deployments under a URL prefix load workers from the app directory instead of the site root.

