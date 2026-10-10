# Glofly: notes for Claude

- **Branches:** everyday work goes on `dev`. `main` is only what's ready to ship; the live server
  (`api.glofly.app`) pulls `main`. Never push to `main` unless Chip asks to ship/merge.
- Full reference: the Messenger project docs `glofly-dev-setup.md` (dev environment, features, API)
  and `glofly-going-live.md` (AWS setup, everyday workflow, releases), `glofly-control.md` (the admin
  app, v1 + v2), `glofly-mac.md`, `glofly-release-0.2.0.md` and `glofly-release-0.2.1.md` (what each
  release added and how to ship it; they win over the older docs until folded in).
- Server changes must keep working with the previous desktop app version (testers update at
  different times); database migrations only add.
- Event lines: 0.2.0's chat view breaks on event types it doesn't know. A new event type must get a
  plain-text fallback in `legacyEvent` (apps/server/src/messages/routes.ts); newer apps turn
  `eventLine` back into a line (`upgradeEvents` in apps/desktop/src/main/api.ts).
