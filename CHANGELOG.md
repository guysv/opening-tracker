# Changelog

All notable changes to this project will be documented in this file.

## 0.9.0

- Initial public release.
- Resolve worker scripts with `./workers/…` relative to the main bundle so deployments under a URL prefix (e.g. `username.github.io/repo-name/`) load workers from the app directory instead of the site root.

