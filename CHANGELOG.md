# Changelog

All notable changes to this project will be documented in this file.

## 0.9.7

- Add a development-only mobile logging endpoint (`POST /__dev/log`) so device logs appear on the dev machine.
- Surface clearer messages when database access is restricted.
- Improve hover behavior and move row preview in the opening tracker.
- Show a loading overlay while the database initializes in the mobile shell.
- Refine mobile navigation, including default tab handling and related fixes.

## 0.9.6

- Add a mobile shell and touch-oriented navigation for smaller screens.
- Improve move animation handling on the board and in the opening tracker.
- Refine sidebar and storage layout, button icons, and player card sizing.

## 0.9.5

- Add date range filtering for games and related UI enhancements.
- Improve imports with queue management and clearer import UI.
- Encode move sequences in game URLs for sharing and deep links.
- Refine analyze link styling and accessibility.
- Add a collapsible bookmark sidebar with persisted expand/collapse state.
- Refresh explorer filters, header layout, and CSS for overflow and alignment.

## 0.9.4

- Coordinate SQLite database ownership across tabs so only one tab holds the connection; show clear feedback when the database is in use elsewhere.
- Gate bookmark sidebar, opening explorer, and storage actions when the database is unavailable or locked; storage panel reflects in-use state and avoids conflicting downloads.
- Refresh sidebar layout, player card styling, and related UI polish.

## 0.9.3

- Add bookmark hover previews in the opening explorer and improve board interaction polish.
- Improve move animation flow and hints handling across `ChessBoard` and `OpeningTracker`.
- Update evaluation bar behavior for perspective-aware score display.

## 0.9.2

- **CI:** Release workflow no longer passes `GITHUB_TOKEN` to Wrangler (Cloudflare deploy only needs API token + account ID). Tagged release to verify Cloudflare Pages deploy with repo secrets.

## 0.9.1

- **Hosting:** Production deploy is **Cloudflare Pages** only. GitHub Pages is not used; disable it in the repo settings if it was previously enabled.
- **CI:** Releases (`v*` tags) continue to build, deploy `dist` to Cloudflare, and publish the GitHub Release artifact.

## 0.9.0

- Initial public release.
- Resolve worker scripts with `./workers/…` relative to the main bundle so deployments under a URL prefix load workers from the app directory instead of the site root.

