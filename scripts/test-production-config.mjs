import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import { validateOtaProductionEnvironment } from './ota-production-preflight.mjs';

const root = path.resolve(import.meta.dirname, '..');

function expectedFor(variant) {
  return variant === 'customer'
    ? { label: 'Customer', variant, mode: variant, package: 'com.nandyalride.customer', project: '1158ff7e-1da5-4a6a-9080-14791394da7a', runtime: 'customer-1.0.3', channel: 'production-customer', mapsVariables: ['EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_CUSTOMER', 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY'] }
    : { label: 'Captain', variant, mode: variant, package: 'com.nandyalride.captain', project: '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13', runtime: 'captain-1.0.4', channel: 'production-captain', mapsVariables: ['EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_CAPTAIN'] };
}

function validEnvironment(variant) {
  const expected = expectedFor(variant);
  return {
    APP_VARIANT: variant,
    EXPO_PUBLIC_APP_MODE: variant,
    EXPO_PUBLIC_AUTH_MODE: 'production',
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    [expected.mapsVariables.at(-1)]: 'test-maps-key',
  };
}

function validConfig(variant) {
  const expected = expectedFor(variant);
  return { extra: { appMode: expected.mode, eas: { projectId: expected.project } }, android: { package: expected.package }, runtimeVersion: expected.runtime, updates: { requestHeaders: { 'expo-channel-name': expected.channel } } };
}

function loadConfigStatus(variant) {
  const file = path.join(root, 'apps', variant, 'src/config/productionConfig.ts');
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, module: { exports: {} }, require: () => ({ expoConfig: { extra: { appMode: variant } } }), process: { env: {} } };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: file });
  return sandbox.module.exports.getProductionConfigStatus;
}

for (const variant of ['customer', 'captain']) {
  const expected = expectedFor(variant);
  test(`${variant}: valid EAS production OTA environment passes`, () => {
    assert.equal(validateOtaProductionEnvironment({ env: validEnvironment(variant), config: validConfig(variant), expected }).ok, true);
  });
  for (const [label, mutate] of [
    ['missing Supabase URL', (env) => delete env.EXPO_PUBLIC_SUPABASE_URL],
    ['missing publishable key', (env) => delete env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    ['missing Maps key', (env) => delete env[expected.mapsVariables.at(-1)]],
    ['missing auth mode', (env) => delete env.EXPO_PUBLIC_AUTH_MODE],
    ['wrong app variant', (env) => { env.APP_VARIANT = variant === 'customer' ? 'captain' : 'customer'; }],
    ['wrong app mode', (env) => { env.EXPO_PUBLIC_APP_MODE = variant === 'customer' ? 'captain' : 'customer'; }],
  ]) test(`${variant}: ${label} fails OTA preflight`, () => {
    const env = validEnvironment(variant); mutate(env);
    assert.equal(validateOtaProductionEnvironment({ env, config: validConfig(variant), expected }).ok, false);
  });
  test(`${variant}: wrong runtime fails OTA preflight`, () => {
    const config = validConfig(variant); config.runtimeVersion = 'wrong-runtime';
    assert.equal(validateOtaProductionEnvironment({ env: validEnvironment(variant), config, expected }).ok, false);
  });
  test(`${variant}: opposite app values fail OTA preflight`, () => {
    const env = validEnvironment(variant); env.APP_VARIANT = variant === 'customer' ? 'captain' : 'customer'; env.EXPO_PUBLIC_APP_MODE = env.APP_VARIANT;
    assert.equal(validateOtaProductionEnvironment({ env, config: validConfig(variant), expected }).ok, false);
  });

  const getProductionConfigStatus = loadConfigStatus(variant);
  test(`${variant}: valid startup configuration permits navigation`, () => {
    assert.equal(getProductionConfigStatus({ appMode: variant, supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'key' }).ok, true);
  });
  test(`${variant}: missing Supabase URL blocks startup`, () => {
    assert.equal(getProductionConfigStatus({ appMode: variant, supabaseUrl: '', supabasePublishableKey: 'key' }).reason, 'SUPABASE_URL_MISSING');
  });
  test(`${variant}: missing Supabase key blocks startup`, () => {
    assert.equal(getProductionConfigStatus({ appMode: variant, supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: '' }).reason, 'SUPABASE_PUBLISHABLE_KEY_MISSING');
  });
  test(`${variant}: invalid app mode blocks startup`, () => {
    assert.equal(getProductionConfigStatus({ appMode: 'invalid', supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'key' }).reason, 'APP_MODE_INVALID');
  });
  test(`${variant}: App gates the operational navigator`, () => {
    const source = fs.readFileSync(path.join(root, 'apps', variant, 'App.tsx'), 'utf8');
    assert.match(source, /ProductionConfigurationErrorScreen/);
    assert.match(source, /if \(!productionConfigStatus\.ok\) return/);
  });
}
