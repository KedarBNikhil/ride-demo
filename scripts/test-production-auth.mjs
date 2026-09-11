import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const variants = ['customer', 'captain'];

function loadPolicy(variant) {
  const file = path.join(root, 'apps', variant, 'src/services/authModePolicy.ts');
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, module: { exports: {} } };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: file });
  return sandbox.module.exports.resolveAuthMode;
}

for (const variant of variants) {
  const resolveAuthMode = loadPolicy(variant);
  test(`${variant}: production is selected explicitly`, () => {
    assert.equal(resolveAuthMode('production', false), 'production');
  });
  test(`${variant}: missing or invalid mode cannot enable demo`, () => {
    assert.equal(resolveAuthMode(undefined, false), 'production');
    assert.equal(resolveAuthMode(undefined, true), 'production');
    assert.equal(resolveAuthMode('preview', false), 'production');
    assert.equal(resolveAuthMode('production ', true), 'production');
  });
  test(`${variant}: demo requires explicit development configuration`, () => {
    assert.equal(resolveAuthMode('demo', false), 'production');
    assert.equal(resolveAuthMode('demo', true), 'demo');
  });
}

test('Customer production guard retains no local-ride fallback', () => {
  const source = fs.readFileSync(path.join(root, 'apps/customer/src/services/rideCreation.ts'), 'utf8');
  assert.match(source, /if \(isProductionAuthMode\) throw new Error\('SUPABASE_NOT_CONFIGURED'\)/);
  assert.match(source, /if \(!isSupabaseConfigured\)/);
});

test('Captain onboarding has no anonymous-auth fallback', () => {
  const source = fs.readFileSync(path.join(root, 'apps/captain/src/services/captainOnboarding.ts'), 'utf8');
  assert.doesNotMatch(source, /signInAnonymously|demoAuthService/);
  assert.match(source, /throw new Error\('AUTHENTICATION_REQUIRED'\)/);
});

test('Captain mock request service has no production import path', () => {
  const sourceRoot = path.join(root, 'apps/captain/src');
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(ts|tsx)$/.test(entry.name) && !target.endsWith('mockRideRequestService.ts')) files.push(target);
    }
  };
  visit(sourceRoot);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /mockRideRequestService/);
});

test('Captain operational navigation requires backend-approved account state', () => {
  const source = fs.readFileSync(path.join(root, 'apps/captain/src/navigation/CaptainAppNavigator.tsx'), 'utf8');
  assert.match(source, /accountStatus === 'approved'/);
  assert.match(source, /<CaptainOnboardingStack/);
});
