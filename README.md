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

The customer location picker works with bundled Nandyal suggestions and an interactive pin-drop map without configuration. To enable live Google Places autocomplete and Google Maps on Android, set `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` before building a development client. No key is committed to this demo.

## Stage 1 conventions

- All customer-facing strings live in `src/locales/en.json` and `src/locales/te.json`.
- Use `formatNumber`, `formatFare`, and `formatOtp` from `src/utils/format.ts`; numeric output is always Western digits.
- Add subsequent UI within the existing stack routes rather than changing the flow structure.
