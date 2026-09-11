#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
if [[ "$action" != "--preflight" && "$action" != "--publish" ]]; then
  echo "Usage: npm run ota:preflight | npm run ota:publish" >&2
  exit 64
fi

readonly PACKAGE="com.nandyalride.captain"
readonly PROJECT="6acc15fd-28b0-4f3a-b825-7e8e5d05cc13"
readonly RUNTIME="captain-1.0.4"
readonly CHANNEL="production-captain"
readonly VARIANT="captain"
readonly MODE="captain"
readonly MAPS_VARIABLES="EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_CAPTAIN"
export CI=1

run_with_eas_production_environment() {
  npx --yes eas-cli@latest env:exec production "$1"
}

assert_optional_identity_override() {
  local name="$1" expected="$2" actual="${!1:-}"
  if [[ -n "$actual" && "$actual" != "$expected" ]]; then
    echo "ERROR: $name must be $expected for Captain OTA export. Aborting." >&2
    exit 1
  fi
}

assert_optional_identity_override APP_VARIANT "$VARIANT"
assert_optional_identity_override EXPO_PUBLIC_APP_MODE "$MODE"
assert_optional_identity_override EXPO_PUBLIC_AUTH_MODE production

npm run typecheck
git diff --check
channel_file="$(mktemp "${TMPDIR:-/tmp}/sawaari-captain-channel.XXXXXX")"
export_dir="$(mktemp -d "${TMPDIR:-/tmp}/sawaari-captain-export.XXXXXX")"
trap 'rm -f "$channel_file"; rm -rf "$export_dir"' EXIT
run_with_eas_production_environment "APP_VARIANT=$VARIANT EXPO_PUBLIC_APP_MODE=$MODE EXPO_PUBLIC_AUTH_MODE=production node ../../scripts/ota-production-preflight.mjs Captain $VARIANT $MODE $PACKAGE $PROJECT $RUNTIME $CHANNEL $MAPS_VARIABLES"
npx --yes eas-cli@latest channel:view "$CHANNEL" --json > "$channel_file"
node - "$channel_file" "$CHANNEL" <<'NODE'
const fs = require('fs'); const [file, channel] = process.argv.slice(2); const result = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!(result.currentPage?.updateBranches ?? []).some((branch) => branch.name === channel)) { throw new Error(`Channel ${channel} is not mapped to its own branch.`); }
NODE
printf -v export_command 'APP_VARIANT=%q EXPO_PUBLIC_APP_MODE=%q EXPO_PUBLIC_AUTH_MODE=production npx expo export --platform android --clear --output-dir %q' "$VARIANT" "$MODE" "$export_dir"
run_with_eas_production_environment "$export_command"
test -f "$export_dir/metadata.json"
if [[ "$action" == "--preflight" ]]; then echo "Captain OTA preflight passed; nothing published."; exit 0; fi
npx --yes eas-cli@latest update --branch "$CHANNEL" --platform android --skip-bundler --input-dir "$export_dir" --message "${OTA_MESSAGE:?Set OTA_MESSAGE before publishing}"
npx --yes eas-cli@latest update:list --branch "$CHANNEL" --platform android --runtime-version "$RUNTIME" --limit 1 --json
