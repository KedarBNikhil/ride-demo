import { execFileSync } from 'node:child_process';

export function validateOtaProductionEnvironment({ env, config, expected }) {
  const errors = [];
  const required = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'EXPO_PUBLIC_AUTH_MODE', 'APP_VARIANT', 'EXPO_PUBLIC_APP_MODE'];
  for (const name of required) {
    if (!env[name]?.trim()) errors.push(`ERROR: ${name} is missing. Aborting ${expected.label} OTA export.`);
  }

  const mapsVariables = expected.mapsVariables.filter((name) => env[name]?.trim());
  if (mapsVariables.length === 0) errors.push(`ERROR: ${expected.mapsVariables.join(' or ')} is missing. Aborting ${expected.label} OTA export.`);
  if (env.EXPO_PUBLIC_AUTH_MODE !== 'production') errors.push(`ERROR: EXPO_PUBLIC_AUTH_MODE must be production for ${expected.label} OTA export.`);
  if (env.APP_VARIANT !== expected.variant) errors.push(`ERROR: APP_VARIANT must be ${expected.variant} for ${expected.label} OTA export.`);
  if (env.EXPO_PUBLIC_APP_MODE !== expected.mode) errors.push(`ERROR: EXPO_PUBLIC_APP_MODE must be ${expected.mode} for ${expected.label} OTA export.`);

  const actual = {
    mode: config.extra?.appMode,
    package: config.android?.package,
    project: config.extra?.eas?.projectId,
    runtime: config.runtimeVersion,
    channel: config.updates?.requestHeaders?.['expo-channel-name'],
  };
  const requiredConfig = { mode: expected.mode, package: expected.package, project: expected.project, runtime: expected.runtime, channel: expected.channel };
  for (const [key, value] of Object.entries(requiredConfig)) {
    if (actual[key] !== value) errors.push(`ERROR: resolved ${key} does not match ${expected.label} OTA identity. Aborting export.`);
  }
  return { ok: errors.length === 0, errors, actual, mapsVariable: mapsVariables[0] ?? null };
}

function parseArguments(argv) {
  const [label, variant, mode, packageName, project, runtime, channel, mapsVariables] = argv;
  if (!mapsVariables) throw new Error('Usage: ota-production-preflight.mjs <label> <variant> <mode> <package> <project> <runtime> <channel> <maps-var[,maps-var]>');
  return { label, variant, mode, package: packageName, project, runtime, channel, mapsVariables: mapsVariables.split(',') };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const expected = parseArguments(process.argv.slice(2));
  const config = JSON.parse(execFileSync('npx', ['expo', 'config', '--json'], { encoding: 'utf8', env: process.env }));
  const result = validateOtaProductionEnvironment({ env: process.env, config, expected });
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exit(1);
  }
  console.log(`${expected.label} EAS production environment: loaded`);
  console.log('Supabase URL: present');
  console.log('Supabase publishable key: present');
  console.log(`Maps configuration: present via ${result.mapsVariable}`);
  console.log(`Auth mode: ${process.env.EXPO_PUBLIC_AUTH_MODE}`);
  console.log(`Variant: ${process.env.APP_VARIANT}`);
  console.log(`App mode: ${process.env.EXPO_PUBLIC_APP_MODE}`);
  console.log(`Runtime: ${result.actual.runtime}`);
  console.log(`Channel: ${result.actual.channel}`);
  console.log('Project identity match: YES');
}
