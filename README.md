# Weigh In

A small weight tracker for several people. Log weights (dated today by default,
or any past day), and chart up to three people over time. Plain HTML, CSS and
JavaScript, no build step and no server-side code, so any static host works.

## Two ways to use it

- **Signed in (invited people only).** Sign in with Google. Each person gets
  their own private data in Firebase (Firestore): only they can see it (the admin
  can't), and it syncs across all their devices. It also works offline: changes
  sync when the device is back online.
- **Without signing in.** Data is kept in this browser's `localStorage` only,
  exactly as before. Firebase isn't even loaded in this mode.

The first visit asks which one to use. People who already had data in the browser
carry on without signing in, and can sign in from the **Data** tab. Once signed in,
**Data → Copy it into my account** moves their browser data across.

## Who can sign in

- The list is the `allow` collection in Firestore, keyed by lowercase Google email.
  Anyone else who signs in sees "hasn't been invited" and can read or write nothing.
- **One admin**, added by hand in the Firebase console. The admin invites and
  removes people on the **Admin** tab. Removing someone locks them out at once;
  their data is kept (unreadable) and comes back if they are invited again.
- All of this is enforced by `firestore.rules`, not just by the app.

## Data

```
allow/{email}                          { name, role: "admin" | "member", addedBy }
users/{uid}/people/{id}                { id, name }
users/{uid}/entries/{personId}_{date}  { id, personId, date "YYYY-MM-DD", kg }
```

- **Data → Export JSON** downloads a backup in both modes; **Import JSON**
  restores one (replacing the current data, after confirming).
- Without signing in: a reminder appears once there are unexported changes worth
  backing up. Storage is per site address, so moving the app to a new URL starts empty.
- Signing out wipes the browser's offline copy of the account's data.

## Setting up Firebase (once)

1. [Firebase console](https://console.firebase.google.com) → **Add project** (e.g. `weigh-in`).
2. **Authentication** → *Get started* → **Sign-in method** → **Google** → Enable.
   Then **Settings → Authorized domains** → add `caomhindev.github.io`.
3. **Firestore Database** → *Create database* → production mode.
4. Deploy the security rules **before** publishing the config:
   `npx firebase use --add` (pick the project), then `npm run deploy:rules`.
5. **Project settings → Your apps → Web app** → copy the config object into
   `js/firebase-config.js` (replacing `null`).
6. **Firestore → Start collection** `allow` → document ID = the admin's Google
   email **in lowercase** → fields `role` (string) = `admin`, `name` (string).
7. Recommended hardening, in the [Google Cloud console](https://console.cloud.google.com)
   for the same project → **APIs & Services → Credentials** → the *Browser key*:
   restrict *Application restrictions* to the websites `https://caomhindev.github.io/*`
   and `http://localhost:8090/*`, and *API restrictions* to Identity Toolkit API,
   Token Service API and Cloud Firestore API. Also set a budget alert under **Billing**.

Until step 5 is done the app works as before, without the sign-in option.

## Security

- `firestore.rules`: closed by default; per-user data is readable and writable only
  by its owner while they're invited; every field is type- and size-checked.
  Tested in `tests/rules/rules.test.js`.
- The Firebase web config in `js/firebase-config.js` is public by design. It
  identifies the project; it doesn't grant access.
- `index.html` sets a Content-Security-Policy that only allows this site's own
  scripts plus Google sign-in and Firebase. The app builds its pages with DOM
  calls, never `innerHTML`, so names and data are always shown as text.
- Test sign-in shortcuts exist only with the local emulators on `localhost`.

## Run locally

```sh
npm run serve        # http://localhost:8090, also reachable from your LAN (uses the real project)
```

It must be served over http(s); opening `index.html` as a file won't load the
JavaScript modules.

## Tests

```sh
npm install
npm test             # data and chart logic (Node's built-in test runner)
npm run test:rules   # security rules, against the Firestore emulator (needs Java 21)
npm run test:e2e     # browser tests (Playwright) against the Auth + Firestore emulators
npm run test:live    # browser tests against the live site (sign-in tests skipped)
```

The browser tests also save light/dark screenshots to `screenshots/`.

## Deploy

Live at https://caomhindev.github.io/weigh-in/ (GitHub Pages). Every push to `main`
runs all tests, and publishes the site only if they pass (`.github/workflows/deploy.yml`).
Only `index.html`, `styles.css`, `icon.svg` and `js/` are published.

```sh
npm run deploy       # same as: git push origin main
npm run deploy:rules # after changing firestore.rules
```
