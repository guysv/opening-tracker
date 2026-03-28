---
name: release-bump-and-publish
description: Bumps package version, updates CHANGELOG, commits, tags v*, pushes to origin, and waits for the GitHub Release workflow via gh. Use when the user asks to release, ship a version, cut a tag, or bump and publish (e.g. "release 0.9.5", "push v1.2.0").
---

# Release: bump, commit, push, tag, wait for pipeline

## Input (required)

The user supplies the **new version**. Accept any of:

- `0.9.5` (preferred in `package.json` / changelog headings)
- `v0.9.5` (Git tag form)

**Normalize:**

- `semver` = digits and dots only (strip a leading `v`).
- `tag` = `v` + `semver` (e.g. `v0.9.5`).

If the user omits the version, ask once for `X.Y.Z` or `vX.Y.Z` before proceeding.

## Preconditions

- Working tree should be clean or changes intentionally included in the release; do not tag unrelated WIP without confirmation.
- Run `git fetch origin --tags` and abort if `tag` already exists on `origin`.
- Confirm `semver` is greater than `package.json` `version` (or matches an explicit user exception).

## Steps

1. **Bump** — Set `"version"` in `package.json` to `semver`.

2. **Changelog** — Prepend a `## semver` section to `CHANGELOG.md` (after the intro paragraph). Summarize changes since the previous tag:
   - `git log $(git describe --tags --abbrev=0)..HEAD --oneline` (exclude the upcoming version-bump commit if run after commit—prefer inspecting diff/commits *before* the release commit, or describe user-facing edits from the diff).
   - Use the same bullet style as existing entries (concise, user-facing).

3. **Commit** — Stage `package.json` and `CHANGELOG.md`:

   ```text
   chore: release <semver>
   ```

   One commit that includes both files avoids shipping a tag without changelog updates.

4. **Tag** — `git tag <tag>` (annotated optional; lightweight matches current repo practice).

5. **Push** — Push the default branch (e.g. `main`) and the tag:

   ```bash
   git push origin HEAD
   git push origin <tag>
   ```

6. **Wait for pipeline** — Release is triggered by tag `v*` (`.github/workflows/release.yml`).

   ```bash
   gh run list --workflow=release.yml --limit 1
   gh run watch <RUN_ID> --exit-status
   ```

   If the run ID is not ready yet, poll `gh run list` briefly, then watch.

7. **Verify** — `gh release view <tag>` — confirm published release and artifact `opening-tracker-dist-<tag>.tar.gz`.

## Failure handling

- If `gh run watch` exits non-zero: show the run URL, summarize failed jobs from `gh run view <id> --log-failed`, do not claim success.
- Do not run `gh release create` manually unless the workflow is removed; it would duplicate or bypass CI artifacts.

## Project-specific notes

- **Workflow file:** `release.yml` (not `release.yaml`).
- **Cloudflare / artifact:** Success implies deploy + GitHub Release with generated notes and tarball.
