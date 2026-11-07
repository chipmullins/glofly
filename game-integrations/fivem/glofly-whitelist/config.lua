Config = {}

-- ── Your Glofly key ──────────────────────────────────────────────────────────────
-- Make one in Glofly: your constellation → Settings → Integrations → New API key, with the
-- "Link game servers" permission. Put it in server.cfg, NOT here (server.cfg isn't shared):
--
--   set glofly_api_key "gfk_..."
--
-- Use `set`, never `setr` or `sets`: those would send your key to every player.
Config.ApiKeyConvar = 'glofly_api_key'
Config.ApiUrl = 'https://api.glofly.app'

-- ── Who gets in ──────────────────────────────────────────────────────────────────
-- 'glofly'  only Glofly decides (members of your constellation; see RequiredRoles)
-- 'both'    let people in if Glofly OR Discord says yes, while your players link over a few
--           weeks. Then switch to 'glofly'. (Discord settings below.)
-- 'roles'   let everyone in; Glofly only hands out roles (ACE groups / events) to linked players
Config.Mode = 'glofly'

-- Only let in members who have at least one of these Glofly roles (by name). Empty = any member.
-- Tip: an onboarding answer ("Do you want to join our FiveM server?") can give this role.
Config.RequiredRoles = { }

-- Glofly role name → ACE group. Players get these groups while they're on the server (refreshed
-- every join). Needs this in server.cfg:
--   add_ace resource.glofly-whitelist command.add_principal allow
--   add_ace resource.glofly-whitelist command.remove_principal allow
Config.RoleGroups = {
  -- ['Admin'] = 'group.admin',
  -- ['Police'] = 'group.police',
}

-- When Glofly can't be reached (rare): 'deny' (safe) or 'allow' (keep the server open).
-- In 'both' mode Discord still decides.
Config.WhenGloflyDown = 'deny'

-- How often a waiting player's link is checked again (seconds). Glofly allows 120 checks a
-- minute per key, so keep this at 10 or more.
Config.RecheckSeconds = 10
-- How long someone may wait on the "Link your Glofly account" card (seconds).
Config.WaitSeconds = 600

-- ── Discord (only for Mode = 'both') ─────────────────────────────────────────────
-- Your own Discord bot's token goes in server.cfg too:  set glofly_discord_token "..."
-- The bot must be in your Discord server (Server Members intent on).
Config.Discord = {
  TokenConvar = 'glofly_discord_token',
  GuildId = '',
  -- Discord role ids that count as whitelisted (empty = any member of the Discord server)
  RoleIds = { },
}

-- Words players see (change them to your language).
Config.Text = {
  checking = 'Checking your Glofly account…',
  notMember = 'You\'re not in %s on Glofly yet. Ask for an invite, join it, then connect again.',
  needRole = 'You need the %s role in %s on Glofly to join this server.',
  banned = 'You can\'t join this server.',
  locked = 'Your Glofly account can\'t join right now.',
  frozen = '%s is paused by the Glofly team right now.',
  down = 'Glofly isn\'t answering right now. Try again in a minute.',
  noLicense = 'Start FiveM/RedM signed in with your Cfx.re account to join.',
  waitedTooLong = 'The code ran out. Connect again for a new one.',
  notConfigured = 'This server\'s Glofly key isn\'t set up yet.',
}

-- Write what happens to the server console.
Config.Debug = false
