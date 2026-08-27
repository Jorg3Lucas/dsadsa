#!/bin/bash
set -e

BASE="3c01b8c"
COMMIT1="13ffd3f"
COMMIT2="012fab7"
COMMIT3="bc487fc"
COMMIT4_HEAD="9638423"  # last commit in the range

# Clean state
git reset --hard "$BASE" 2>/dev/null

# ============================================================
# Helper: extract file from a specific commit into working tree
# ============================================================
extract() {
  local ref="$1"
  shift
  for f in "$@"; do
    if git cat-file -e "$ref:$f" 2>/dev/null; then
      mkdir -p "$(dirname "$f")"
      git show "$ref:$f" > "$f"
    fi
  done
}

# ============================================================
# Helper: delete file from working tree
# ============================================================
remove() {
  for f in "$@"; do
    rm -f "$f"
  done
}

# ============================================================
# COMMIT 1: Core ranking system refactor
# ============================================================
echo ">>> Commit 1: Core ranking system refactor"

# Core modules from COMMIT1
extract "$COMMIT1" \
  src/core/ranking-storage.js \
  src/core/ranking-cache.js \
  src/core/ranking-logger.js \
  src/core/ranking-scraper.js \
  src/core/ranking-service.js \
  src/core/ranking-sync-engine.js \
  src/core/ranking-utils.js \
  src/core/ranking-events.js \
  src/core/ranking-constants.js \
  src/core/ranking-handlers.js \
  src/core/ranking-deploy.js

# Handlers from COMMIT1
extract "$COMMIT1" \
  src/handlers/ranking-approvals.js \
  src/handlers/ranking-commands.js \
  src/handlers/ranking-confirmations.js \
  src/handlers/ranking-management.js \
  src/handlers/ranking-notify.js \
  src/handlers/ranking-pilot.js \
  src/handlers/ranking-welcome.js

# Entry points & config from COMMIT1
extract "$COMMIT1" \
  src/index.js \
  src/deploy-commands.cjs \
  src/auto-backup.js \
  src/lang/lang.js \
  src/lang/lang.json \
  package.json

# Recovery tool from COMMIT1
extract "$COMMIT1" recover-db.js

# Remove old files
remove eslint.config.js google_credentials.json src/handlers/ranking-scan.js
git rm --cached eslint.config.js google_credentials.json src/handlers/ranking-scan.js 2>/dev/null || true

# Tests from COMMIT1
for f in $(git diff-tree --no-commit-id --name-only -r "$COMMIT1" | grep '^tests/'); do
  extract "$COMMIT1" "$f"
done

# README from COMMIT1
extract "$COMMIT1" README.md

# .gitignore from COMMIT1
extract "$COMMIT1" .gitignore

git add -A
git commit -m "Refactor ranking system with enterprise storage, test coverage, and scraper improvements

- Rewrite ranking-storage.js with atomic writes, corruption detection,
  write locks, and save coalescing (debounce)
- Add ranking-cache.js for local ranking data caching
- Add ranking-logger.js with buffered log writes
- Improve ranking-scraper.js with retry logic and rate limiting
- Add ranking-service.js centralized nickname lookup with fuzzy matching
- Refactor sync engine: pilot auto-link, anti-impostor, temp registration
  cleanup, pre-registration auto-conversion, and allied-clan-aware role sync
- Add comprehensive test suite (18 test files)
- Add recover-db.js for database reconstruction from Discord state
- Add auto-backup system with rotation and integrity verification
- Remove eslint.config.js, google_credentials.json, ranking-scan handler"

# ============================================================
# COMMIT 2: Server merge — remove absorbed servers, add merge resolution
# ============================================================
echo ">>> Commit 2: Server merge"

# Extract server-merge-specific files from COMMIT2
extract "$COMMIT2" \
  src/core/ranking-constants.js \
  src/core/ranking-service.js \
  src/handlers/ranking-management.js \
  src/handlers/ranking-registration.js \
  recover-db.js

# Server merge tests from COMMIT2
for f in $(git diff-tree --no-commit-id --name-only -r "$COMMIT2" | grep '^tests/'); do
  extract "$COMMIT2" "$f"
done

git add -A
git commit -m "Update server constants for Aug 18, 2026 server merge

- Remove 22 absorbed servers from ranking constants
- Add SERVER_MERGES map and resolveServerName() for merged servers
- Migrate allied clans to new server/world IDs
- Add tests for merged server handling"

# ============================================================
# COMMIT 3: 72h grace period for leaving allied clans
# ============================================================
echo ">>> Commit 3: 72h grace period"

# Files from COMMIT3
extract "$COMMIT3" \
  src/core/ranking-sync-engine.js \
  src/core/ranking-constants.js \
  src/core/ranking-deploy.js \
  src/deploy-commands.cjs \
  src/handlers/ranking-commands.js \
  src/lang/lang.json \
  README.md

# Grace-related test changes from COMMIT3
for f in $(git diff-tree --no-commit-id --name-only -r "$COMMIT3" | grep '^tests/'); do
  extract "$COMMIT3" "$f"
done

git add -A
git commit -m "Add 72h grace period for members leaving allied clans

- Members who leave an allied clan keep their role for 72h before removal
- Add /grace command to show remaining grace time per member
- Grace timer resets when member returns to an allied clan
- Prevents false role removal during temporary clan switches for events"

# ============================================================
# COMMIT 4: Grace period controls and cleanup
# ============================================================
echo ">>> Commit 4: Grace controls"

# Commit d482fe4: Remove automatic grace warning DM
extract "d482fe4" \
  src/core/ranking-sync-engine.js \
  README.md

for f in $(git diff-tree --no-commit-id --name-only -r "d482fe4" | grep '^tests/'); do
  extract "d482fe4" "$f"
done

# Commit 197c3d5: Remove unused grace command entry
extract "197c3d5" src/lang/lang.json

# Commit e301906: Add !enablegrace / !disablegrace
extract "e301906" \
  src/core/ranking-events.js \
  src/core/ranking-sync-engine.js \
  src/handlers/ranking-commands.js

git add -A
git commit -m "Add !enablegrace / !disablegrace commands and remove grace DM warning

- Add text commands to toggle 72h grace period on/off
- Add /resetgrace admin command to force-expire all grace timers
- Remove automatic DM warning when grace starts (was causing noise)
- Clean up unused grace entries from lang.json"

# ============================================================
# COMMIT 5: Sync engine role management fixes
# ============================================================
echo ">>> Commit 5: Sync fixes"

# Commit d285390: fuzzy match fix
extract "d285390" src/core/ranking-sync-engine.js

# Commit cae092c: non-registered strip
extract "cae092c" src/core/ranking-sync-engine.js

# Commit b9a8565: remove validation step
extract "b9a8565" \
  src/core/ranking-deploy.js \
  src/core/ranking-sync-engine.js \
  src/deploy-commands.cjs \
  src/handlers/ranking-commands.js \
  src/lang/lang.json \
  package.json

git add -A
git commit -m "Fix sync engine role management and remove validation step

- Remove role when fuzzy match is on non-allied clan (was keeping it)
- Always strip role from non-registered members regardless of validation flag
- Remove ranking validation step that caused role add/remove cycle
- Remove /validation and /disablevalidation slash commands"

# ============================================================
# COMMIT 6: Boosting World servers
# ============================================================
echo ">>> Commit 6: BW servers"

# Commit 53876ae: Add BW
extract "53876ae" src/core/ranking-constants.js

# Commit 2d67d03: Exclude BW from scrape
extract "2d67d03" src/core/ranking-constants.js

git add -A
git commit -m "Add Boosting World (BW) servers to ranking constants

- Add BW server definitions to ALL_WORLDS
- Exclude BW from ranking scrape (no forum ranking available)"

# ============================================================
# COMMIT 7: Set daily sync to 20:00 BRT
# ============================================================
echo ">>> Commit 7: Sync schedule"

extract "87935f2" \
  src/core/ranking-events.js \
  src/core/ranking-sync-engine.js \
  README.md

git add -A
git commit -m "Set daily sync to 20:00 BRT

- Change cron schedule from midnight to 20:00 BRT
- Update README with correct sync time"

# ============================================================
# COMMIT 8: /update command and region selector fix
# ============================================================
echo ">>> Commit 8: /update + region fix"

extract "4ab6e33" src/handlers/ranking-management.js

extract "5bb5b41" \
  src/core/ranking-deploy.js \
  src/deploy-commands.cjs \
  src/index.js

git add -A
git commit -m "Add /update slash command and fix region selector crash

- Add /update command to pull latest code and restart via PM2
- Fix crash in buildRegionSelectorView for regions without WORLDS_BY_REGION entry"

# ============================================================
# COMMIT 9: .gitignore cleanup and temp file removal
# ============================================================
echo ">>> Commit 9: .gitignore cleanup"

extract "9638423" .gitignore

# Remove tracked temp files
git rm -f database_ranking_PRE_RECOVER_2026-08-07T07-27-19-079Z.json pending_registrations.json 2>/dev/null || true

git add -A
git commit -m "Clean up .gitignore and remove runtime-generated temp files

- Remove obsolete entries (database.json, database_gold.json, etc.)
- Add database_ranking.tmp, database_ranking_*.json patterns
- Add logs/ directory, remove overly broad *.json wildcard
- Remove tracked database recovery snapshot and pending registrations"

echo ""
echo ">>> Rebase complete! Final history:"
git log --oneline "$BASE"..HEAD
