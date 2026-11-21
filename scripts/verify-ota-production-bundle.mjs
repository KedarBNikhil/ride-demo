import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [exportDirectory] = process.argv.slice(2);
if (!exportDirectory) throw new Error('Usage: verify-ota-production-bundle.mjs <expo-export-directory>');

function findAndroidBundle(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      const result = findAndroidBundle(path);
      if (result) return result;
    } else if (entry.endsWith('.hbc')) return path;
  }
  return null;
}

const bundlePath = findAndroidBundle(exportDirectory);
if (!bundlePath) throw new Error('ERROR: Android OTA bundle is missing.');

const bundle = readFileSync(bundlePath).toString('latin1');
const required = [
  ['EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL],
  ['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
];
for (const [name, value] of required) {
  if (!value?.trim()) throw new Error(`ERROR: ${name} is unavailable while validating the OTA bundle.`);
  if (!bundle.includes(value)) throw new Error(`ERROR: ${name} was not baked into the Android OTA bundle. Refusing to publish.`);
}

console.log('Customer OTA bundle contains required production configuration.');
