# Glofly Control

The admin app: only for Glofly's admin, never part of testers' installs or auto-updates.
Electron + React + TypeScript, same stack and safety rules as `apps/desktop`.

- `npm run dev -w apps/control` — against the server on this PC (`http://localhost:4000`)
- `npm run build:win -w apps/control` — installer for the live server (`.env.production`:
  `https://api.glofly.app`) → `apps/control/dist/Glofly-Control-<version>-setup.exe`

Before it can sign in, the server needs `ADMIN_KEY` (and on the live server `ADMIN_IPS`), and an
admin made with `npm run admin:setup -w apps/server -- <username>` (live server:
`docker compose exec -it server node dist/admin/setup.js <username>`). Full steps: the
"Glofly Control" section of `glofly-going-live.md` in the Messenger project.
