#!/usr/bin/env bash
set -euo pipefail

# Export first, inspect the exact variant manifest, then upload that verified
# export. CI=1 is required because Expo's exporter rejects EAS's legacy
# forwarded --non-interactive flag.
variant="${1:-}"
action="${2:-}"
if [[ ( "$variant" != "customer" && "$variant" != "captain" ) || ( "$action" != "--preflight" && "$action" != "--publish" ) ]]; then
  echo "Usage: bash scripts/ota-release.sh <customer|captain> <--preflight|--publish>" >&2
  exit 64
fi

case "$variant" in
  customer)
    package="com.nandyalride.customer"
    project="1158ff7e-1da5-4a6a-9080-14791394da7a"
    runtime="1.0.2"
    channel="production-customer"
    ;;
  captain)
    package="com.nandyalride.captain"
    project="6acc15fd-28b0-4f3a-b825-7e8e5d05cc13"
    runtime="1.0.3"
    channel="production-captain"
    ;;
esac

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
for env_file in .env .env.local; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
done

export APP_VARIANT="$variant"
export EXPO_PUBLIC_APP_MODE="$variant"
export EXPO_PUBLIC_AUTH_MODE=production
export CI=1

npm run typecheck
git diff --check

config_file="$(mktemp "${TMPDIR:-/tmp}/sawaari-${variant}-ota-config.XXXXXX")"
channel_file="$(mktemp "${TMPDIR:-/tmp}/sawaari-${variant}-ota-channel.XXXXXX")"
export_dir="$(mktemp -d "${TMPDIR:-/tmp}/sawaari-${variant}-ota-export.XXXXXX")"
trap 'rm -f "$config_file" "$channel_file"; rm -rf "$export_dir"' EXIT

npx expo config --json > "$config_file"
node - "$config_file" "$variant" "$package" "$project" "$runtime" "$channel" <<'NODE'
const fs = require('fs');
const [configFile, mode, packageName, projectId, runtimeVersion, channel] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const actual = {
  mode: config.extra?.appMode,
  package: config.android?.package,
  project: config.extra?.eas?.projectId,
  updateUrl: config.updates?.url,
  runtime: config.runtimeVersion,
  scheme: config.scheme,
};
const expected = {
  mode,
  package: packageName,
  project: projectId,
  updateUrl: `https://u.expo.dev/${projectId}`,
  runtime: runtimeVersion,
  scheme: `exp+nandyal-ride-${mode}`,
};
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error('OTA identity check failed.', { expected, actual, channel });
  process.exit(1);
}
console.log('OTA identity verified.', { ...actual, channel });
NODE

# This uses the selected project's identity from app.config.ts. It proves the
# requested channel maps to the same-named branch before any upload.
npx --yes eas-cli@latest channel:view "$channel" --json > "$channel_file"
node - "$channel_file" "$channel" <<'NODE'
const fs = require('fs');
const [channelFile, channel] = process.argv.slice(2);
const result = JSON.parse(fs.readFileSync(channelFile, 'utf8'));
const branches = result.currentPage?.updateBranches ?? [];
if (!branches.some((branch) => branch.name === channel)) {
  console.error('OTA channel is not mapped to its expected branch.', { channel, branches });
  process.exit(1);
}
console.log('OTA channel mapping verified.', channel);
NODE

npx expo export --platform android --clear --output-dir "$export_dir"
test -f "$export_dir/metadata.json"
echo "Verified ${variant} Android export."

if [[ "$action" == "--preflight" ]]; then
  echo "Preflight passed; no OTA published."
  exit 0
fi

npx --yes eas-cli@latest update \
  --branch "$channel" \
  --platform android \
  --skip-bundler \
  --input-dir "$export_dir" \
  --message "${OTA_MESSAGE:?Set OTA_MESSAGE before publishing}"
npx --yes eas-cli@latest update:list --branch "$channel" --platform android --runtime-version "$runtime" --limit 1 --json
