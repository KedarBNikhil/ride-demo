# Sawaari Captain

This is the only Captain Expo project. Run all Expo, EAS Build, and EAS Update
commands from this directory.

- Android package / iOS bundle ID: `com.nandyalride.captain`
- EAS project: `6acc15fd-28b0-4f3a-b825-7e8e5d05cc13`
- Update channel: `production-captain`
- Runtime namespace: `captain-1.0.3`

Use `npm run ota:preflight` before any future update. It must pass before a
separately authorized `npm run ota:publish`. Do not use Customer configuration,
assets, Firebase credentials, runtime, channel, or EAS project in this app.
