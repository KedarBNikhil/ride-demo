#!/usr/bin/env bash
set -euo pipefail

# Compatibility entry point for existing Customer release instructions. The
# shared guard performs the export, identity checks, and verified upload.
exec "$(cd "$(dirname "$0")" && pwd)/ota-release.sh" customer "${1:-}"
