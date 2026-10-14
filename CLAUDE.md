# Glofly: notes for Claude

- **Branches:** everyday work goes on `dev`. `main` is only what's ready to ship; the live server
  (`api.glofly.app`) pulls `main`. Never push to `main` unless Chip asks to ship/merge.
- Full reference: the Messenger project docs `glofly-dev-setup.md` (dev environment, features, API)
  and `glofly-going-live.md` (AWS setup, everyday workflow, releases), `glofly-control.md` (the admin
  app, v1 + v2), `glofly-mac.md`, `glofly-release-0.2.0.md`, `glofly-release-0.2.1.md` and
  `glofly-release-0.2.2.md`, `glofly-release-0.3.0.md` and `glofly-release-0.4.0.md` (what each release added and how to ship it;
  they win over the older docs until folded in), `glofly-android.md` (the phone app; plan and costs in `glofly-android-plan.md`).
- Server changes must keep working with the previous desktop app version (testers update at
  different times); database migrations only add.
- Event lines: 0.2.0's chat view breaks on event types it doesn't know. A new event type must get a
  plain-text fallback in `legacyEvent`; newer apps turn `eventLine` back into a line
  (`upgradeEvents`). Both live in packages/shared/src/events.ts (the server, desktop and phone use them).
- Shared code: `packages/shared` (`@glofly/shared`) holds the API types, rules and pure helpers
  every app must agree on. The server builds it to `dist/`; desktop (Vite) and mobile (Metro) read
  its source. A change there counts as a server change for releases. `npm test -w @glofly/shared`.
- Phone app: `apps/mobile` (Expo SDK 57, expo-router, `src/` holds everything; Android first, iOS
  later from the same code). Its own Android code is the Expo module `apps/mobile/modules/glofly-native`
  (Kotlin: FCM pushes, notifications with Reply, call ringing, the call service, the Opus recorder).
  Phones send `X-Glofly-Platform`; no header means desktop, so the desktop app is never affected.
  The app's screens also run in a browser (`npx expo export -p web`) for testing against a local server.
- Native code can't be compiled in Claude's sandbox. Check it by pushing to a `ci/<name>` branch: the
  "Android build" Action (`.github/workflows/android-build.yml`) builds the APK there (also on `dev`).
  Delete the branch afterwards (Claude's GitHub access can't delete branches; ask Chip).
- 0.4.0: "Pause Glofly" (admin/pause.ts) answers 503 `paused` to everything but /admin, /health and
  /status while on; new routes must stay behind that gate (they are if added after it in index.ts).
  Restricted (family) accounts are enforced in the server (friends/rules.ts `isRestricted`,
  `groupBreaksRestriction`): new ways to make friends, find people or join groups must check them.
  iPad: `src/lib/layout.ts` (`useWide`, two panes from 700 pt); pushed screens show in the right pane.
- Glofly 2.0 (planned, not built): project doc `glofly-2.0-plans.md`. Constellations' screens and
  animations are approved as-is: build them exactly from `docs/design/constellations/` (the
  mockup source) and the exact spec in that doc.
