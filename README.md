# Nandyal Ride Demo — Stage 1

Expo foundation for independent Customer and Captain flows in English and Telugu.

## Run

```bash
npm install
npm run start
```

## Supabase Phase 1: demo authentication

Customer and captain sign-in is intentionally local-only for this demo: no SMS
is sent and the accepted OTP is always `1234`. The connected Supabase project
currently contains the Phase 1 profile schema and row-level-security policies,
but the app does not call Supabase Auth yet.

Captain onboarding is gated separately: its documents belong in the private
`captain-documents` bucket, and a captain profile is created only after staff
verify all required documents and approve the onboarding application.

The launcher provides separate Customer and Captain experiences. Language choices persist independently at `nandyal-ride-demo.customer.language` and `nandyal-ride-demo.captain.language`.

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
