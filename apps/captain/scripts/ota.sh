#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
if [[ "$action" != "--preflight" && "$action" != "--publish" ]]; then
  echo "Usage: npm run ota:preflight | npm run ota:publish" >&2
  exit 64
fi

readonly PACKAGE="com.nandyalride.captain"
readonly PROJECT="6acc15fd-28b0-4f3a-b825-7e8e5d05cc13"
readonly RUNTIME="captain-1.0.3"
readonly CHANNEL="production-captain"
export CI=1

npm run typecheck
git diff --check
config_file="$(mktemp "${TMPDIR:-/tmp}/sawaari-captain-config.XXXXXX")"
channel_file="$(mktemp "${TMPDIR:-/tmp}/sawaari-captain-channel.XXXXXX")"
export_dir="$(mktemp -d "${TMPDIR:-/tmp}/sawaari-captain-export.XXXXXX")"
trap 'rm -f "$config_file" "$channel_file"; rm -rf "$export_dir"' EXIT
npx expo config --json > "$config_file"
node - "$config_file" <<'NODE'
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expected = { mode: 'captain', package: 'com.nandyalride.captain', project: '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13', runtime: 'captain-1.0.3', channel: 'production-captain' };
const actual = { mode: config.extra?.appMode, package: config.android?.package, project: config.extra?.eas?.projectId, runtime: config.runtimeVersion, channel: config.updates?.requestHeaders?.['expo-channel-name'] };
if (JSON.stringify(actual) !== JSON.stringify(expected)) { console.error('Captain OTA identity check failed.', { expected, actual }); process.exit(1); }
NODE
npx --yes eas-cli@latest channel:view "$CHANNEL" --json > "$channel_file"
node - "$channel_file" "$CHANNEL" <<'NODE'
const fs = require('fs'); const [file, channel] = process.argv.slice(2); const result = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!(result.currentPage?.updateBranches ?? []).some((branch) => branch.name === channel)) { throw new Error(`Channel ${channel} is not mapped to its own branch.`); }
NODE
npx expo export --platform android --clear --output-dir "$export_dir"
test -f "$export_dir/metadata.json"
if [[ "$action" == "--preflight" ]]; then echo "Captain OTA preflight passed; nothing published."; exit 0; fi
npx --yes eas-cli@latest update --branch "$CHANNEL" --platform android --skip-bundler --input-dir "$export_dir" --message "${OTA_MESSAGE:?Set OTA_MESSAGE before publishing}"
npx --yes eas-cli@latest update:list --branch "$CHANNEL" --platform android --runtime-version "$RUNTIME" --limit 1 --json
