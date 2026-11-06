# Weigh In

A small weight tracker for several people. Log weights (dated today by default,
or any past day), and chart up to three people over time. Plain HTML, CSS and
JavaScript, no build step and no server-side code, so any static host works.

## Data

- Saved automatically in the browser's `localStorage`, on this device only.
- **Data → Export JSON** downloads a backup; **Import JSON** restores one
  (replacing what's in the browser, after confirming).
- A reminder appears once there are unexported changes worth backing up.
- Storage is per site address: moving the app to a new URL starts empty, so
  export from the old address and import at the new one.

## Run locally

```sh
npm run serve        # http://localhost:8090, also reachable from your LAN
```

It must be served over http(s); opening `index.html` as a file won't load the
JavaScript modules.

## Tests

```sh
npm test             # data and chart logic (Node's built-in test runner)
npm run test:e2e     # browser tests in headless Chromium (Playwright)
BASE_URL=https://caomhindev.github.io/weigh-in/ npm run test:e2e   # against the live site
```

The browser tests also save light/dark screenshots to `screenshots/`.

## Deploy

Live at https://caomhindev.github.io/weigh-in/ (GitHub Pages). Every push to `main` runs all tests, and publishes
the site only if they pass (`.github/workflows/deploy.yml`). Only
`index.html`, `styles.css`, `icon.svg` and `js/` are published.

```sh
npm run deploy       # same as: git push origin main
```
