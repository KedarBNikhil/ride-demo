import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const checkout = read('supabase/functions/razorpay-ride-checkout/index.ts');
const migration = read('supabase/migrations/20261015172401_razorpay_ride_payments.sql');
const settlement = read('apps/customer/src/screens/CustomerRideSettlement.tsx');

assert.match(checkout, /eq\('id', rideId\)\.eq\('customer_id', userData\.user\.id\)/);
assert.match(checkout, /customer_charge_type !== 'standard'/);
assert.match(checkout, /Math\.round\(Number\(ride\.customer_charge_amount\) \* 100\)/);
assert.match(checkout, /signatureMatches\(orderId, paymentId, signature, razorpayKeySecret\)/);
assert.match(checkout, /payment\?\.status !== 'captured'/);
assert.match(checkout, /payment_method: 'razorpay'/);
assert.doesNotMatch(checkout, /RAZORPAY_KEY_SECRET[^\n]*return/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.razorpay_ride_payments from public, anon, authenticated/);
assert.match(migration, /payment_method in \('cash', 'upi', 'razorpay'\)/);
assert.match(settlement, /startRazorpayRideCheckout\(rideId\)/);
assert.match(settlement, /isRazorpayRideCheckoutEnabled/);

console.log('Razorpay ride checkout safeguards are present.');
