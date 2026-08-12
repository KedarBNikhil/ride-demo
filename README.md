# Nandyal Ride Demo — Stage 1

Expo foundation for independent Customer and Captain flows in English and Telugu.

## Run

```bash
npm install
npm run start
```

The launcher provides separate Customer and Captain experiences. Language choices persist independently at `nandyal-ride-demo.customer.language` and `nandyal-ride-demo.captain.language`.

## Location services

The customer location picker works with bundled Nandyal suggestions and an interactive pin-drop map without configuration. To enable live Google Places autocomplete and Google Maps on Android, set `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` before building a development client. No key is committed to this demo.

## Stage 1 conventions

- All customer-facing strings live in `src/locales/en.json` and `src/locales/te.json`.
- Use `formatNumber`, `formatFare`, and `formatOtp` from `src/utils/format.ts`; numeric output is always Western digits.
- Add subsequent UI within the existing stack routes rather than changing the flow structure.
