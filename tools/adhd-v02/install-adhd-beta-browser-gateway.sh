#!/usr/bin/env bash
# RETIRED: This installer attempted to hot-reload the EXISTING production
# adhd-assistant-lan Caddy container. The owner's live instance rejected
# the reload even though the candidate configuration validated.
# Never retry or restart production Caddy to work around this.
set -Eeuo pipefail
echo 'BLOCKED: Production Caddy hot-reload path is retired.' >&2
echo 'Use the independently isolated beta gateway installer after CI and review:' >&2
echo 'tools/adhd-v02/install-adhd-photo-independent-gateway.sh' >&2
echo 'Original Caddyfile and backup must be verified before new gateway setup.' >&2
exit 1
