# Nandyal Ride Demo — Stage 1

Expo foundation for independent Customer and Captain flows in English and Telugu.

## Run

```bash
npm install
npm run start
```

## Separate Customer and Captain apps

The project has one shared source tree and three Expo build variants. Customer
and Captain use distinct Android package names and iOS bundle identifiers, so
they can be installed side by side and do not share device storage or a
Supabase session.

```bash
# Customer app — com.nandyalride.customer
npm run start:customer

# Captain app — com.nandyalride.captain
npm run start:captain

# Optional local launcher that still lets you choose either flow
npm run start:demo
```

Use matching `APP_VARIANT` and `EXPO_PUBLIC_APP_MODE` values when creating
native builds (for example, both set to `customer`) so each build receives its
own app identity and opens its matching flow. Both variants continue to share
the same Supabase project and database.

## Supabase Phase 1: demo authentication

Customer and captain sign-in is intentionally local-only for this demo: no SMS
is sent and the accepted OTP is always `1234`. The connected Supabase project
currently contains the Phase 1 profile schema and row-level-security policies,
but the app does not call Supabase Auth yet.

Captain onboarding is gated separately: its documents belong in the private
`captain-documents` bucket, and a captain profile is created only after staff
verify all required documents and approve the onboarding application.

The launcher provides separate Customer and Captain experiences. Language choices persist independently at `nandyal-ride-demo.customer.language` and `nandyal-ride-demo.captain.language`.

## Captain ride-notification handoff

Captain ride notifications carry a `rideId` and `offerId`. Tapping one from the
background or after the Captain app was terminated opens the app and displays
that exact offer only when it is still pending and belongs to the signed-in
captain. Foreground dispatch remains on the existing Supabase Realtime flow.

This cannot be tested in Expo Go. Build and install the Captain development
client after configuring FCM credentials for `com.nandyalride.captain` in the
Captain EAS project, then run:

```bash
eas build --platform android --profile development-captain
npm run start:captain
```

On a physical device, send a `ride_offer` notification with the real pending
`rideId` and `offerId`, background or terminate the Captain app, tap it, and
confirm the matching request sheet appears. The included `firebase/nandyalride-captain.json`
is native build input, so any Firebase credential/configuration change requires
a new development build before it can be tested.

## Supabase Phase 2: ride creation

Apply `supabase/migrations/004_ride_creation.sql` after the existing migrations.
It creates customer-owned `rides` and immutable `ride_status_history` records,
with RLS policies that permit an authenticated customer to create and read only
their own requested rides. The migration includes the explicit Data API grants
needed for projects where new public tables are not exposed automatically.

The customer booking confirmation screen calls `src/services/rideCreation.ts`.
With `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set,
it creates or reuses an anonymous Supabase session and inserts the ride. Enable
Anonymous Sign-Ins in Supabase Auth Providers for this demo path. Without those
environment values, the UI intentionally retains its local, non-persistent demo
booking flow.

## Location services

The customer location picker works with bundled Nandyal suggestions and an interactive pin-drop map without configuration. To enable live Google Places autocomplete and Google Maps on Android, set `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` before building a development client. For EAS builds, configure those values in the EAS build environment; `.env.local` is ignored and is not uploaded. The app configuration rejects an EAS build with no Maps key, rather than producing an APK with a blank map. No key is committed to this demo.

## Stage 1 conventions

- All customer-facing strings live in `src/locales/en.json` and `src/locales/te.json`.
- Use `formatNumber`, `formatFare`, and `formatOtp` from `src/utils/format.ts`; numeric output is always Western digits.
- Add subsequent UI within the existing stack routes rather than changing the flow structure.

## Operator dashboard (web analytics)

`dashboard/` is an npm workspace containing the operator web dashboard: Vite +
React + TypeScript + Tailwind, reading the same Supabase project as the mobile
apps. It provides an overview of platform KPIs, per-customer and per-captain
activity drill-downs, payment reconciliation queues with operator actions, and
heuristic fraud signals.

```bash
npm run dashboard:dev        # http://localhost:5173
npm run dashboard:build      # typecheck + production build to dashboard/dist
npm run dashboard:typecheck
```

Setup:

1. Copy `dashboard/.env.example` to `dashboard/.env.local` and fill in
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` with the same values
   the mobile apps use in the root `.env.local`.
2. Apply `supabase/migrations/20260823130000_dashboard_analytics_access.sql`
   to the Supabase project (`supabase db push`). It grants read-only analytics
   access to settlement operators, adds aggregate views for charts, and adds
   the `operator_resolve_captain_payment_issue` RPC.
3. Seed yourself as an operator with the service role (SQL editor):

   ```sql
   insert into public.settlement_operators (user_id)
   values ('<your-auth-user-uuid>');
   ```

4. Run `npm run dashboard:dev` and sign in via phone OTP (or email OTP) with
   that account. Non-operators see an "not authorized" screen; every query is
   additionally protected by RLS on the server.

Operator actions available: confirm/flag settlements, update or hold captain
payouts, resolve payout disputes, resolve captain-reported payment issues.
