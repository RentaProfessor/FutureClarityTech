# Backup & Restore Guide

Historical record of the September 2025 mobile-optimization change, kept for the
restore procedure. Run every command from the repository root.

## Backups taken before that change

- **Git branch:** `backup-before-mobile-optimization-20250929-165114` (local and remote)
- **Local snapshot:** `backups/mobile-optimization-20250929-165128/`

Note: `backups/` is no longer tracked by git. It is a local-only directory, ignored
via `.gitignore`. Do not commit it — it duplicated the entire source tree on a public
repository and carried its own stale copies of config files.

## How to restore

### Option 1 — restore from the backup branch (recommended)

```bash
git checkout backup-before-mobile-optimization-20250929-165114
git checkout -b restore-from-backup
```

Inspect the result, then merge into `main` through a normal pull request.

### Option 2 — restore from the local snapshot

```bash
cp -r backups/mobile-optimization-20250929-165128/* src/
git add . && git commit -m "restore: revert to pre-mobile-optimization snapshot"
```

### Option 3 — reset to an earlier commit

```bash
git log --oneline
git checkout -b restore-from-<commit>  <commit>
```

Prefer a new branch over `git reset --hard` on `main`. Force-pushing a rewritten
`main` to a shared remote discards history that other clones and deploys may depend
on, and it does not reliably remove anything from GitHub's servers — dangling commits
stay reachable through the API. If you ever need to remove a *secret* from history,
rotate the credential first; treat the history rewrite as cleanup, never as the fix.

## What that change covered

Files: `src/components/Footer.astro`, `src/components/Header.astro`,
`src/layouts/Layout.astro`, `src/pages/index.astro`, `src/pages/portfolio.astro`,
`src/styles/global.css`

Scope: mobile-first responsive layout, iOS Safari safe-area and input-zoom handling,
touch target sizing, and accessibility passes.

---

**Last updated:** August 2026
