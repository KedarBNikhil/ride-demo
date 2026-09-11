import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'apps/customer/src/services/rideDispatch.ts');
const source = fs.readFileSync(file, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sandbox = {
  exports: {},
  module: { exports: {} },
  require: () => ({}),
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(output, sandbox, { filename: file });
const { customerRideLifecycle } = sandbox.module.exports;

const completedRide = {
  id: 'ride-123', status: 'completed', customer_id: 'customer-123', captain_id: 'captain-123',
  ride_type: 'bike', pickup_address: 'Pickup', drop_address: 'Drop',
  pickup_latitude: 15.48, pickup_longitude: 78.48, drop_latitude: 15.49, drop_longitude: 78.49,
  estimated_fare: 20, payment_status: 'declared', customer_rating: null,
};

test('an open payment issue releases a completed ride from Customer payment restoration', () => {
  assert.equal(customerRideLifecycle({ ...completedRide, has_open_payment_issue: true }), 'none');
  assert.equal(customerRideLifecycle(completedRide), 'payment');
});

test('the Customer resolver fetches issue state before choosing a payment ride', () => {
  assert.match(source, /customerRideHasOpenPaymentIssue/);
  assert.match(source, /ridesWithPaymentIssueState[\s\S]*customerRideLifecycle/);
});

test('the booking invariant exempts only rides with an open Customer or Captain payment issue', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260911101426_customer_payment_issue_releases_booking.sql'), 'utf8');
  assert.match(migration, /public\.customer_payment_issues[\s\S]*issue\.status = 'open'/);
  assert.match(migration, /public\.captain_payment_issues[\s\S]*issue\.status = 'open'/);
  assert.match(migration, /customer_ride_has_open_payment_issue/);
});
