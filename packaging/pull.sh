#!/usr/bin/env bash
# Brings your local Pixel Pals copy up to date with GitHub. Works from any shell
# (fish, zsh, bash):
#   bash packaging/pull.sh
#
# If you have your own edits you want to throw away, force GitHub's copy:
#   FORCE=1 bash packaging/pull.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  echo "==> No git checkout here, nothing to update."
  exit 0
fi

remote=${PIXELPALS_REMOTE:-origin}
branch=$(git rev-parse --abbrev-ref HEAD)

echo "==> Looking for updates on $remote/$branch"
git fetch --quiet "$remote" "$branch"

# The installer rewrites these files itself (icons are converted to RGBA and
# Cargo.lock is regenerated), so they are always "changed" after a build.
# Put them back first, otherwise git refuses to merge them.
if ! git diff --quiet HEAD -- src-tauri/icons 2>/dev/null; then
  echo "==> Restoring installer-generated icons"
  git checkout -- src-tauri/icons
fi
if [ -f src-tauri/Cargo.lock ] &&
  ! git ls-files --error-unmatch src-tauri/Cargo.lock >/dev/null 2>&1; then
  echo "==> Removing untracked Cargo.lock (GitHub now tracks this file)"
  rm -f src-tauri/Cargo.lock
fi

if [ "${FORCE:-0}" = "1" ]; then
  echo "==> FORCE=1: discarding local edits and taking $remote/$branch"
  git reset --hard "$remote/$branch"
elif ! git merge --ff-only "$remote/$branch" 2>/dev/null; then
  echo "==> Local edits are in the way of this update."
  echo "    Keep them: commit or stash them, then run this script again."
  echo "    Throw them away: FORCE=1 bash packaging/pull.sh"
  exit 1
fi

echo "==> Now at: $(git log -1 --format='%h %s')"
