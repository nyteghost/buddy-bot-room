#!/usr/bin/env bash
# The legacy git-based auto-updater is intentionally disabled.
# This entry point does not fetch, overwrite, execute or install remote code.
set -euo pipefail
echo "Pixel Pals automatic source updater is disabled." >&2
echo "To update, independently review the release and exact source revision," >&2
echo "manually check out that reviewed revision, then run packaging/install.sh." >&2
exit 1
