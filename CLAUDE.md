# Glofly: notes for Claude

- **Branches:** everyday work goes on `dev`. `main` is only what's ready to ship; the live server
  (`api.glofly.app`) pulls `main`. Never push to `main` unless Chip asks to ship/merge.
- Full reference: the Messenger project docs `glofly-dev-setup.md` (dev environment, features, API)
  and `glofly-going-live.md` (AWS setup, everyday workflow, releases).
- Server changes must keep working with the previous desktop app version (testers update at
  different times); database migrations only add.
