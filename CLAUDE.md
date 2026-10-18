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
- Electron 44 (desktop and Control; Mac app needs macOS 13+). Electron no longer downloads itself
  on `npm install`: the first `npm run dev` (or electron-builder) fetches it. Packaged apps flip
  Electron's fuses (no run-as-Node, no NODE_OPTIONS/--inspect, app.asar only + integrity check).
  Screen sound (0.5.0, `src/main/screenSound/`): a utility process captures only the shared
  window's app, or the whole computer minus Glofly (Windows 10 2004+: loopback-capture + koffi;
  macOS 14.2+: AudioTee); the renderer turns it into the screen share's audio track
  (`lib/screenSound.ts`). Older Windows falls back to Electron's loopback (everything).
- 0.5.2 calls (Oct 17, 2026): **Add people** to a running call (`calls/add.ts`): from a 1-on-1 the
  server makes a new group and re-points the same call to it (no disconnect); only allowed when the
  other person's open apps send the `callMove` feature (older desktop apps can't follow a moved call).
  Group calls can **ring only some members** (others see Join). Group calls end after **7 minutes
  with one person** (last-minute countdown with Stay); voice nebulas are excluded. Event types newer
  than 0.5.1 travel as `eventLine3` (events.ts) so 0.5.0/0.5.1 apps show plain text.
- **0.6.0 (Oct 17, 2026):** the `constellations` branch (Glofly 2.0 work) was merged into `dev` and
  ships as 0.6.0; `dev` is the only working branch again. Migrations 0029–0031 came with it.
- Constellations + My games (0.6.0, built Oct 17, 2026; project doc
  `glofly-2.0-constellations-built.md`, plan and approved spec in `glofly-2.0-plans.md`). Screens and
  animations are approved as-is: keep them exactly like `docs/design/constellations/` (and the DM
  Dock canvas). Server: `src/constellations/` (routes, perms, members, voice, views, activity),
  `src/games/`, `src/admin/constellations.ts`, migration 0029. A nebula is a conversation of kind
  "nebula": hidden from summaries, search, chat partners and pushes, so 0.5.x apps never see them.
  New live events only go to apps that send `auth.features: ['constellations']` (the `user2:<id>`
  room, `emitToUser(..., modernOnly)`). Voice nebulas reuse the calls tables (no ringing, events only
  to people in the room). Every action is checked on the server (`perms.ts`: rank = highest role's
  position, Owner 1e9; you only act on people below you). Restricted (family) accounts are refused.
  Desktop/web: `renderer/src/constellations/` (ConstellationsScreen = the night layer at z-index 45;
  `phase.ts` = the transition; DmDock = the bottom dock). Main process / web bridge only let
  `/constellations/…` and `/games/…` through `constellations:request`.
- **0.7.0 (Oct 17, 2026): Constellations + My games on phones** (project doc `glofly-release-0.7.0.md`).
  `apps/mobile/src/constellations/` (pieces) and `src/app/(main)/constellations/` (the night side: a
  transparentModal stack over the tabs; `transition.tsx` = fly in / fly home), `(main)/games/[id]`.
  Drawn from the approved "Glofly 2.0 Mobile" canvas; keep it matching. JS-only (no native code).
  Server: `GET /constellations/chats/:conversationId`, `push_devices.features` (migration 0032):
  nebula pushes only go to phones that registered with `features: ['constellations']`.
- **0.7.0 Game overlay (Windows desktop, Oct 18, 2026):** `src/main/overlay.ts` = a see-through,
  always-on-top, click-through window over the game's screen while a game Glofly recognises
  (games.ts `runningGame`, now detected even with "Show what I'm playing" off) is the foreground
  window (koffi: GetForegroundWindow + process name). It's the same app page opened with `#overlay`
  (`renderer/src/overlay/OverlayApp.tsx`); the call stays in the main window, which sends a voice
  snapshot (`overlay:voice`, CallContext) and runs the overlay's buttons (`overlay:command`).
  Notifications go to the overlay instead of Windows while it shows (`overlayNotification`). Keys
  are global shortcuts registered only while it's showing. Never inject into games (anti-cheat):
  exclusive full screen isn't supported, by design. Settings → Game overlay (`OverlaySettings.tsx`).
- **0.7.1 (Oct 18, 2026)** (project doc `glofly-release-0.7.1.md`): Watch Together plays **Twitch,
  Vimeo and Dailymotion** too (`WatchState.site`/`live`, shared `watchLinkFrom`; the player page drives
  each site's postMessage protocol, still no third-party script on our address). Apps that know other
  sites send the live feature `watchSites` and `?sites=1` on watch requests; older apps are told
  "nothing's on" for a non-YouTube video (`emitToUserByFeature`). The server announces the end of a
  video itself (`scheduleEnd`). Sync: `noteWatchChange` makes skips apply at once; an ended player is
  never asked to seek. Desktop keeps the video mounted (parked) while a tile is shown big; phones keep
  one `WatchScreen` through rotation. Constellations: live invite pop-up (`constellation:invited`,
  modern-only) + push (sent as `friend_joined` with `userId` `<inviter>?invite=<id>` so every phone
  build can open it), `GET /constellations/news` (the phone's Chats rows), deleting a category moves
  its nebulas to "General" (one transaction, `category_deleted` in the log). The Constellations
  button/tab goes back to your last constellation (quick hop once you're in one).
- **0.7.2 (Oct 18, 2026)** (project doc `glofly-release-0.7.2.md`): the player page (`calls/player.ts`)
  answers YouTube's `readyToListen` with `listening` and only counts the player as connected after
  `initialDelivery`/`infoDelivery` (0.7.1 took `readyToListen` as the answer and stopped the handshake,
  so the real YouTube never became controllable). It adds the params YouTube's own API sends (`forigin`,
  `aoriginsup`, `aorigins`, `gporigin`). No answer in 8 s → one reload, then **"limited"**: play, pause and
  skips reload the player at the right moment. Dailymotion's old embed is retired: the new
  `geo.dailymotion.com/player.html` has no message API, so it's always limited (its own buttons usable).
  Twitch in the desktop app (a file:// window) says why it can't play. Diagnostics: each report carries
  `diag`; Alt-click the sync pill (desktop/web) or long-press it (phones) to show it. Wording shared:
  `watchErrorText` / `watchDiagText` in shared `watch.ts`. Testing tip: a stand-in must send
  `readyToListen` first and answer only after `listening`, like the real embed (0.7.1's stand-ins didn't).
  Desktop: one global rule in `assets/main.css` makes every clickable in a window drag area `no-drag`;
  `markQuitting()` on Electron's `before-quit-for-update` lets the Mac update install.
