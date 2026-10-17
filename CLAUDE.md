# Glofly: notes for Claude

- **Branches:** everyday work goes on `dev`. `main` is only what's ready to ship; the live server
  (`api.glofly.app`) pulls `main`. Never push to `main` unless Chip asks to ship/merge.
- Full reference: the Messenger project docs `glofly-dev-setup.md` (dev environment, features, API)
  and `glofly-going-live.md` (AWS setup, everyday workflow, releases), `glofly-control.md` (the admin
  app, v1 + v2), `glofly-mac.md`, `glofly-release-0.2.0.md`, `glofly-release-0.2.1.md` and
  `glofly-release-0.2.2.md`, `glofly-release-0.3.0.md`, `glofly-release-0.4.0.md` and `glofly-web.md` (what each release added and how to ship it;
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
- Glofly in a browser (chat.glofly.app): `apps/web` is the desktop app's screens
  (`apps/desktop/src/renderer`) built again with `src/bridge` as a browser `window.glofly` (fetch +
  socket.io + browser APIs). A renderer change ships to the web too; browser-only differences go
  behind `isWeb` / `web` from `lib/platform.ts`, and narrow/touch CSS goes in `apps/web/src/web.css`.
  The web signs in with an httpOnly cookie (server `web/session.ts`): CORS, cookie and the live
  connection only for `WEB_ORIGIN`, CSRF header on every change; a web session's token never works as
  a Bearer token. Platform "web" counts like desktop (never a phone). Web push = push_devices rows
  with platform "web" (`push/web.ts`, VAPID keys kept in server_settings). Deployed by the `web`
  service in `deploy/docker-compose.yml` (`deploy/web.Dockerfile`) into the volume Caddy serves.
  A new workspace needs a COPY line in both Dockerfiles. Project doc: `glofly-web.md`.
- 0.5.0 Watch Together (project doc `glofly-watch-together.md`): state per call in memory on the
  server (`calls/watch.ts`), routes under `/calls/:id/watch`, live events `watch:updated` /
  `watch:reaction`. Every app shows YouTube through the server's own page `/watch/player`
  (`calls/player.ts`: only our script on it, YouTube's documented postMessage protocol, no
  YouTube script on our address), kept in step by `watchSyncStep` in packages/shared/src/watch.ts.
  CSPs allow that one frame (desktop `index.html` gets the server address at build time, web
  `vite.config.ts`, Caddy's chat block). Event types newer than 0.4.0 travel as `eventLine2`
  (events.ts) so 0.2.1–0.4.0 apps show plain text instead of an empty line.
- 0.5.0 chat extras and social (project doc `glofly-release-0.5.0.md`): GIFs (`messages/gifs.ts`,
  GIPHY key only on the server, apps load pictures from media.giphy.com by id), link previews
  (`messages/links.ts`: the SSRF-safe fetcher; only the server fetches links), polls/games/fireflies
  (`messages/extras.ts`, rules in shared `games.ts`), lanterns (`messages/lanterns.ts`), videos
  (`messages/video.ts`, ffprobe/ffmpeg). Glows/hangs/birthdays/Year in Glow (`social/`, "Glofly's
  day" = `GLOFLY_TIME_ZONE`, US Central by default), stickers (`stickers/`, background removal with
  ONNX Runtime + `models/u2netp.onnx`), Broadcast now (`broadcasts/`, in memory like Watch Together).
  New message fields are optional and each carries a plain-text `body` for older apps; pushes for
  social news reuse the 0.3.0 friend alert types so no phone needs new native code for them.
- **Constellations branch:** Glofly 2.0 work goes on the `constellations` branch (made from `dev`
  on Oct 14, 2026), never on `dev`, so bug fixes and releases keep going from `dev` untouched.
  Bring fixes in with `git merge dev` on `constellations` now and then; it goes back into `dev`
  only when Chip says 2.0 is ready. Releases (`npm run release`) only run from `dev`.
  Migrations: a new one made on `constellations` gets renumbered after `dev`'s latest when merging
  (drizzle-kit generate again). Drizzle only applies migrations newer than the last one applied, so
  a PC database that ran a `constellations` migration can skip a `dev` one made earlier: tell Chip
  to check (or use a separate database) when switching between the branches.
- Glofly 2.0 (planned, not built): project doc `glofly-2.0-plans.md`. Constellations' screens and
  animations are approved as-is: build them exactly from `docs/design/constellations/` (the
  mockup source) and the exact spec in that doc.
