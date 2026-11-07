# Glofly Whitelist (FiveM + RedM)

Let players into your server by their membership and roles in your **Glofly constellation**, and hand out ACE groups from their Glofly roles. Free and open source.

- Players link once: the connecting screen shows a 6-digit code, they type it in Glofly (Settings → Linked game servers → Enter a code) and join automatically.
- Every join after that is instant: Glofly says who they are and which roles they have.
- Your characters, money, cars and so on stay exactly where they are: QBCore, Qbox and ESX keep them by `license`, and this script keys on the same `license` (check your framework if it uses another identifier).
- Your server only ever learns your own members' Glofly name and roles. No email, friends or messages.

## Install

1. In Glofly, open your constellation → **Settings → Integrations → New API key**. Turn on **Link game servers**. Copy the key (`gfk_…`), shown once.
2. Put `glofly-whitelist` in your `resources` folder.
3. In `server.cfg`:
   ```
   set glofly_api_key "gfk_your_key_here"
   ensure glofly-whitelist

   # only if you use RoleGroups (ACE groups from Glofly roles):
   add_ace resource.glofly-whitelist command.add_principal allow
   add_ace resource.glofly-whitelist command.remove_principal allow
   ```
   Use **`set`**, never `setr` or `sets`: those would send your key to every player.
4. Edit `config.lua` (mode, required roles, role → group map). Restart. The console says `Ready for <your constellation>`.

## Modes

| `Config.Mode` | Who gets in |
|---|---|
| `'glofly'` | Members of your constellation (and, if set, with one of `RequiredRoles`). |
| `'both'` | Anyone Glofly **or** your Discord says yes to, while players link over a few weeks. Linking players see "Join with Discord instead" if Discord says yes. Switch to `'glofly'` when you're ready. Needs your own Discord bot token (`set glofly_discord_token "…"`), `Config.Discord.GuildId` and optionally `RoleIds`. |
| `'roles'` | Everyone. Glofly only hands out ACE groups and the `GetPlayer` info to linked players. |

Tip: use Glofly **onboarding** ("Do you want to join our FiveM server?") to give the role you list in `RequiredRoles`.

## For your other resources

```lua
local info = exports['glofly-whitelist']:GetPlayer(source)
-- { user = { id, username, displayName }, roles = { { id, name, position }, … }, owner = false }

if exports['glofly-whitelist']:HasRole(source, 'Police') then … end

AddEventHandler('glofly:playerReady', function(src, info) … end) -- after they've joined
```

Role changes in Glofly apply the next time the player connects.

## If something's wrong

- `No Glofly key`: the `set glofly_api_key` line is missing from `server.cfg`.
- `this key doesn't work`: it was reset or deleted; make a new one.
- `can't link game servers`: turn on **Link game servers** for the key.
- Players see "Glofly isn't answering": Glofly couldn't be reached. `Config.WhenGloflyDown = 'allow'` keeps your server open meanwhile (in `'both'` mode Discord still decides).
- The key is limited to 120 checks a minute; keep `RecheckSeconds` at 10 or more.

## Testing (for Glofly developers)

`game-integrations/fivem/test/run.py` runs this resource in Lua 5.4 (`pip install lupa`) with FiveM's server functions faked, against a Glofly dev server: `GLOFLY_URL=http://localhost:4000 python3 game-integrations/fivem/test/run.py`.
