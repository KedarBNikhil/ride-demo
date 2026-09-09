# Sawaari Customer

This is the only Customer Expo project. Run all Expo, EAS Build, and EAS Update
commands from this directory.

- Android package / iOS bundle ID: `com.nandyalride.customer`
- EAS project: `1158ff7e-1da5-4a6a-9080-14791394da7a`
- Update channel: `production-customer`
- Runtime namespace: `customer-1.0.2`

Use `npm run ota:preflight` before any future update. It must pass before a
separately authorized `npm run ota:publish`. Do not use Captain configuration,
assets, Firebase credentials, runtime, channel, or EAS project in this app.
