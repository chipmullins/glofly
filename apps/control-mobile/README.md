# Glofly Control for iPhone

The Glofly admin app for Chip's iPhone (0.9.0). It does what desktop Control does when you're away from
your computer: see what's happening, handle reports, act on accounts and constellations, and use the
emergency switches (Pause, Restart, Lockdown, End all calls). Push alerts tell you when something
needs you.

It's for one person. It goes out through **TestFlight, internal testing only**, never the App Store.

- Expo SDK 57, expo-router, iOS only (iPhone, portrait). JavaScript only: there's no native code of
  our own, and EAS builds the app.
- Bundle id `com.glofly.control`, scheme `glofly-control`, version 1.0.0.
- It reuses desktop Control's typed API client (`apps/control/src/renderer/src/lib/api.ts`, imported as
  `@control/api`) and its date helpers (`@control/format`). The phone supplies its own
  `window.control.call` (`src/lib/transport.ts`).

## How it stays safe

1. **The phone is approved once, at home.** In desktop Control, go to Server → Approved phones → Approve a
   new iPhone. The phone makes its own P-256 key, sends the public half along with the 6-character code,
   and keeps the private half in the iOS Keychain behind Face ID. It only works on this device and only
   while the phone has a passcode.
2. **Every request is signed** with that key (`X-Control-Device/Time/Nonce/Signature`, spec in
   `apps/server/src/admin/devices.ts`). That's what lets the phone reach `/admin` from anywhere. The
   server refuses replayed, tampered, old or wrongly-signed requests.
3. **Sign in like desktop**: Face ID unlocks the key, then the admin password and the authenticator code
   (or a backup code). The key and the session token stay in memory only.
4. **You're signed out** after 30 minutes, after 5 minutes in the background, when the server ends the
   session, or when you tap Sign out. If the phone is removed in desktop Control, it wipes its key and
   goes back to "Approve this iPhone".
5. **Dangerous actions** (pause, restart, lockdown, end calls, suspend, delete, freeze, invites off,
   transfer, take down, sign-ups, required update) ask for Face ID right before they're sent.

## Run a development build

You need a development build on the iPhone first (Expo Go can't run it, because of Face ID, the
Keychain and push alerts):

```
cd apps/control-mobile
npx eas build -p ios --profile development     # install it from the link EAS gives you
```

Then, on the PC:

```
cd apps/control-mobile
cp .env.example .env.local      # set EXPO_PUBLIC_SERVER_URL=http://<PC's address>:4000
npx expo start --dev-client
```

Open the app on the iPhone and pick the PC. Development builds allow plain `http://` addresses and
get alerts from Apple's sandbox. Preview and production builds are HTTPS-only.

Checks: `npx tsc --noEmit`, `npx expo export -p ios`, and the transport test against a running local
server, `npx tsx test/transport.e2e.ts`. That test pairs a test phone, signs in from a non-home
address, makes real calls, checks that replays and tampering are refused, then removes the phone.

## Make the TestFlight build

Once only:

1. `cd apps/control-mobile && npx eas init`. This creates the Expo project `glofly-control`. Copy the
   project id it prints into `EXPO_PROJECT_ID` in `app.config.ts`, which turns on over-the-air updates.
2. In App Store Connect, make the app record "Glofly Control" with bundle id `com.glofly.control`. EAS
   offers to do this, and to make the push key and certificates, the first time you build.
3. The server needs its Control alert settings (APNs key, topic `com.glofly.control`). See the 0.9.0
   release doc.

Each build:

```
cd apps/control-mobile
npx eas build -p ios --profile production
npx eas submit -p ios --latest
```

In App Store Connect → TestFlight, add yourself under **Internal Testing** only. Don't make an external
group and don't submit it for App Store review.

## Over-the-air updates

JavaScript-only changes reach the installed app without a new build:

```
npm run update:production -- --message "Fix the reports list"      (the TestFlight build)
npm run update:preview -- --message "..."                         (preview builds)
```

`scripts/update.mjs` forces the live server address and the right variant, so updates never point at
the PC. A build only takes updates made for its own `RUNTIME_VERSION` (`app.config.ts`). **Bump
`RUNTIME_VERSION` and make a new build whenever native things change**: a native package added or
updated, a plugin, or an Info.plist or entitlement setting.

## Screens in a browser (sample data)

To compare screens with the approved mockups without a phone:

```
CONTROL_WEB_PREVIEW=1 npx expo export -p web --output-dir /tmp/control-web
```

Serve that folder as a single-page app (any static server that falls back to `index.html`). Every
page shows made-up data from `src/lib/preview.web.ts`, and nothing talks to a server. Add `?phase=signin`
or `?phase=approve` to see those screens. iPhone builds never include the sample data.
