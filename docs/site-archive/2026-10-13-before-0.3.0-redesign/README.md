# Website archive: before the 0.3.0 redesign (Oct 13, 2026)

The glofly.app home page and logo as they were before the twilight redesign, kept in case we
ever want to go back. This folder is not served by the website (only `site/` is).

| File | What it was |
|---|---|
| `site/index.html` | The old home page (off-white page, Glofly Red accent) |
| `site/icon.png` | The old Glofly Red logo (website, account pages and emails used it) |
| `server/pages.ts.txt` | The old `apps/server/src/web/pages.ts` (the /join, /welcome, /reset, /confirm pages); `.txt` so nothing tries to build it |

The rest of `site/` (chip.jpg, firefly.png, mac.html, privacy.html, terms.html, delete-account.html)
didn't change. The whole old state is also commit `53d24f6` (Version 0.3.0) in git.

**To go back:** copy `site/index.html` and `site/icon.png` over the ones in `site/`, copy
`server/pages.ts.txt` over `apps/server/src/web/pages.ts`, then publish the same way as any
website change (merge to main, server `git pull` + `docker compose up -d --build`). The new
files (`site.css`, `features.html`, `logo.svg`, `og.png`, `apple-touch-icon.png`) can stay;
nothing links to them from the old page.
