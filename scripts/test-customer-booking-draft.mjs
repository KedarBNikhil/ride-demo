import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'apps/customer/src/services/customerBookingDraft.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sandbox = { exports: {}, module: { exports: {} } };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(output, sandbox, { filename: file });
const { hasCompleteCustomerBookingRoute, missingCustomerBookingLocation, toCustomerBookingConfirmationSnapshot, toReusableCustomerBookingDraft } = sandbox.module.exports;

const route = {
  id: 'ride-123',
  pickupOtp: '1234',
  routeQuote: { id: 'quote-123', distanceMeters: 850, durationSeconds: 180, encodedPolyline: 'abc' },
  pickup: 'Life women health club',
  drop: 'Kurnool Road',
  pickupCoordinate: { latitude: 15.4889, longitude: 78.4836 },
  dropCoordinate: { latitude: 15.4931, longitude: 78.4874 },
  kind: 'bike',
  passengerCount: 1,
};

test('a cancelled/searching ride retains a reusable route but drops server state', () => {
  const draft = toReusableCustomerBookingDraft(route);
  assert.deepEqual(JSON.parse(JSON.stringify(draft)), {
    pickup: route.pickup,
    drop: route.drop,
    pickupCoordinate: route.pickupCoordinate,
    dropCoordinate: route.dropCoordinate,
    kind: 'bike',
    passengerCount: 1,
  });
  assert.equal(hasCompleteCustomerBookingRoute(draft), true);
});

test('confirmation is blocked when pickup or drop is absent after cancellation', () => {
  assert.equal(missingCustomerBookingLocation({ ...route, pickup: '' }), 'pickup');
  assert.equal(missingCustomerBookingLocation({ ...route, dropCoordinate: undefined }), 'drop');
  assert.equal(hasCompleteCustomerBookingRoute({ ...route, drop: '   ' }), false);
  assert.equal(missingCustomerBookingLocation({ ...route, pickup: '\u200B\uFEFF' }), 'pickup');
  assert.equal(missingCustomerBookingLocation({ ...route, drop: undefined }), 'drop');
});

test('confirmation keeps the route visible on RideType even if shared ride state later changes', () => {
  const snapshot = toCustomerBookingConfirmationSnapshot(route, route.routeQuote);
  const laterSharedState = { pickup: '', drop: '', kind: 'bike', passengerCount: 1 };
  assert.equal(hasCompleteCustomerBookingRoute(snapshot), true);
  assert.equal(snapshot.pickup, route.pickup);
  assert.equal(snapshot.drop, route.drop);
  assert.equal(hasCompleteCustomerBookingRoute(laterSharedState), false);
});

test('every Customer retry entry point uses the shared draft and confirmation guard', () => {
  const navigator = fs.readFileSync(path.join(root, 'apps/customer/src/navigation/CustomerAppNavigator.tsx'), 'utf8');
  const confirmation = fs.readFileSync(path.join(root, 'apps/customer/src/screens/CustomerScreens.tsx'), 'utf8');
  assert.match(navigator, /clearCustomerRide[\s\S]*toReusableCustomerBookingDraft/);
  assert.match(navigator, /onCancel[\s\S]*toReusableCustomerBookingDraft/);
  assert.match(navigator, /onOpenRide[\s\S]*toReusableCustomerBookingDraft\(selectedRide\)[\s\S]*missingCustomerBookingLocation\(bookingDraft\)/);
  assert.match(navigator, /onNext=\{\(bookingRide\)[\s\S]*missingCustomerBookingLocation\(bookingRide\)[\s\S]*navigate\('BookingConfirm', \{ bookingRide \}\)/);
  assert.match(navigator, /route\.params[\s\S]*bookingRide[\s\S]*onBook=\{async \(confirmedRide, rideId\)[\s\S]*setCustomerRide\(customerRideRef\.current\)/);
  assert.match(confirmation, /missingCustomerBookingLocation\(ride\)[\s\S]*onInvalidRoute\(missingLocation\)/);
});
