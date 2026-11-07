-- Glofly Whitelist: who may join, and which ACE groups they get, from your Glofly constellation.
--
-- On connect the script asks Glofly about the player's license (every Cfx.re player has one; it
-- never changes). Linked and allowed → they're in, with groups from their Glofly roles. Not linked
-- → Glofly gives a one-time code; the connecting screen shows it until they enter it in Glofly
-- (checked again every few seconds). Glofly only tells this server its own members' Glofly name and
-- roles. Your characters, money and cars stay in your own database by license, as before.

local community = 'this community'
local ready = false
local players = {} -- [source] = { user, roles, owner, license }
local granted = {} -- [license] = { group, ... } (ACE groups this script added)

local function log(fmt, ...)
  if Config.Debug then print(('[glofly-whitelist] ' .. fmt):format(...)) end
end

local function identifiersOf(src)
  local license, discord, extra = nil, nil, {}
  for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do
    if id:sub(1, 8) == 'license:' and not license then license = id
    elseif id:sub(1, 8) == 'discord:' then discord = id:sub(9); extra[#extra + 1] = id
    elseif id:sub(1, 6) == 'fivem:' then extra[#extra + 1] = id end
  end
  return license, discord, extra
end

local function gameName()
  return GetConvar('gamename', 'gta5') == 'rdr3' and 'redm' or 'fivem'
end

local function hasRequired(roles)
  if #(Config.RequiredRoles or {}) == 0 then return true end
  for _, r in ipairs(roles or {}) do
    for _, want in ipairs(Config.RequiredRoles) do
      if r.name:lower() == want:lower() then return true end
    end
  end
  return false
end

-- ACE groups from Glofly roles: take away what this script gave last time, then give the new ones.
local function applyGroups(license, roles)
  for _, group in ipairs(granted[license] or {}) do
    ExecuteCommand(('remove_principal identifier.%s %s'):format(license, group))
  end
  local now = {}
  for _, r in ipairs(roles or {}) do
    local group = Config.RoleGroups[r.name]
    if group and group:match('^[%w%._%-]+$') then
      ExecuteCommand(('add_principal identifier.%s %s'):format(license, group))
      now[#now + 1] = group
    end
  end
  granted[license] = now
end

-- Asks Glofly about a player. Returns the answer table, or nil when Glofly couldn't be reached.
local function lookup(license, name, extra)
  local status, body = GloflyHttp.glofly('POST', '/api/v1/links/lookup', {
    game = gameName(), identity = license, playerName = name,
    -- Left out when empty (an empty Lua table could be written as {} instead of []).
    identities = #extra > 0 and extra or nil,
  })
  if status == 200 and type(body) == 'table' then return body end
  log('lookup answered %s', tostring(status))
  return nil
end

-- Not allowed in: the words for why.
local function refusal(answer)
  local t = Config.Text
  if answer.reason == 'banned' then return t.banned end
  if answer.reason == 'account_locked' then return t.locked end
  if answer.reason == 'frozen' then return t.frozen:format(community) end
  return t.notMember:format(community)
end

-- Decides for an answer from Glofly: 'in' (with info), 'out' (with words) or 'link' (with code).
local function decide(answer)
  if answer.linked then
    if not answer.allowed then return 'out', refusal(answer) end
    if Config.Mode ~= 'roles' and not hasRequired(answer.roles) then
      return 'out', Config.Text.needRole:format(table.concat(Config.RequiredRoles, ' or '), community)
    end
    return 'in', answer
  end
  if answer.code then return 'link', answer.code end
  return 'out', refusal(answer)
end

local function admit(src, license, answer, deferrals)
  players[src] = { license = license, user = answer and answer.user or nil, roles = answer and answer.roles or {}, owner = answer and answer.owner or false }
  if answer then applyGroups(license, answer.roles) end
  deferrals.done()
end

AddEventHandler('playerConnecting', function(name, _, deferrals)
  local src = source
  deferrals.defer()
  Wait(0)
  if not ready then
    if Config.Mode == 'roles' then return deferrals.done() end
    return deferrals.done(Config.Text.notConfigured)
  end
  deferrals.update(Config.Text.checking)
  local license, discord, extra = identifiersOf(src)
  if not license then
    if Config.Mode == 'roles' then return deferrals.done() end
    return deferrals.done(Config.Text.noLicense)
  end

  local answer = lookup(license, name, extra)
  local discordOk = nil
  if Config.Mode == 'both' then discordOk = GloflyHttp.discordAllows(discord) end

  if not answer then
    if Config.Mode == 'roles' then return deferrals.done() end
    if Config.Mode == 'both' and discordOk then return admit(src, license, nil, deferrals) end
    if Config.WhenGloflyDown == 'allow' then return admit(src, license, nil, deferrals) end
    return deferrals.done(Config.Text.down)
  end

  local verdict, value = decide(answer)
  if verdict == 'in' then return admit(src, license, value, deferrals) end
  if Config.Mode == 'roles' then return admit(src, license, nil, deferrals) end
  if verdict == 'out' then
    if Config.Mode == 'both' and discordOk then return admit(src, license, nil, deferrals) end
    return deferrals.done(value)
  end

  -- Not linked yet: show the code until it's linked (checked again every few seconds), they
  -- press "Join with Discord instead" ('both' mode), or they wait too long.
  local code = value
  local choice = nil
  local function show()
    deferrals.presentCard(GloflyCard.link(community, code, Config.Mode == 'both' and discordOk == true), function(data)
      choice = type(data) == 'table' and data.glofly or 'check'
    end)
  end
  show()
  local waited, sinceCheck = 0, 0
  while waited < Config.WaitSeconds * 1000 do
    Wait(250)
    waited = waited + 250
    sinceCheck = sinceCheck + 250
    if GetPlayerName(src) == nil and waited > 2000 then return end -- they gave up
    if choice == 'discord' and Config.Mode == 'both' and discordOk then return admit(src, license, nil, deferrals) end
    if choice == 'check' or sinceCheck >= Config.RecheckSeconds * 1000 then
      choice, sinceCheck = nil, 0
      local again = lookup(license, name, extra)
      if again then
        local v, val = decide(again)
        if v == 'in' then return admit(src, license, val, deferrals) end
        if v == 'out' then return deferrals.done(val) end
        if val ~= code then code = val end
      end
      show()
    end
  end
  deferrals.done(Config.Text.waitedTooLong)
end)

-- The player's connecting id becomes their game id once they're in.
RegisterNetEvent('playerJoining', function(oldId)
  local src = source
  local info = players[tonumber(oldId)]
  if info then
    players[tonumber(oldId)] = nil
    players[src] = info
    TriggerEvent('glofly:playerReady', src, info)
  end
end)

AddEventHandler('playerDropped', function()
  local info = players[source]
  if info then applyGroups(info.license, {}) end
  players[source] = nil
end)

-- ── For other resources ──────────────────────────────────────────────────────────
-- exports['glofly-whitelist']:GetPlayer(src) → { user = { id, username, displayName }, roles = { { id, name, position } }, owner } or nil
exports('GetPlayer', function(src)
  local info = players[tonumber(src)]
  if not info then return nil end
  return { user = info.user, roles = info.roles, owner = info.owner }
end)
-- exports['glofly-whitelist']:HasRole(src, 'Police') → true / false
exports('HasRole', function(src, roleName)
  local info = players[tonumber(src)]
  if not info then return false end
  for _, r in ipairs(info.roles or {}) do
    if r.name:lower() == tostring(roleName):lower() then return true end
  end
  return false
end)

-- ── Start: check the key once and learn the community's name ─────────────────────
CreateThread(function()
  if not GloflyHttp.apiKey() then
    print(('[glofly-whitelist] No Glofly key. Add  set %s "gfk_..."  to server.cfg (use set, not setr/sets).'):format(Config.ApiKeyConvar))
    return
  end
  local status, me = GloflyHttp.glofly('GET', '/api/v1/me')
  if status == 401 then
    print('[glofly-whitelist] Glofly says this key doesn\'t work. Make a new one in Settings → Integrations.')
    return
  end
  if status ~= 200 or type(me) ~= 'table' then
    print(('[glofly-whitelist] Couldn\'t reach Glofly (%s). Players will see: %s'):format(tostring(status), Config.Text.down))
    ready = true
    return
  end
  local canLink = false
  for _, s in ipairs(me.scopes or {}) do if s == 'link' then canLink = true end end
  if not canLink then
    print('[glofly-whitelist] This key can\'t link game servers. Turn on "Link game servers" for it in Settings → Integrations.')
    return
  end
  community = (me.constellation and me.constellation.name) or community
  ready = true
  print(('[glofly-whitelist] Ready for %s (%s mode).'):format(community, Config.Mode))
end)
