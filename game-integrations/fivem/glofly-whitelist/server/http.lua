-- Glofly Whitelist: the HTTP calls (Glofly's bot API, and Discord for 'both' mode).

GloflyHttp = {}

local function apiKey()
  local key = GetConvar(Config.ApiKeyConvar, '')
  if key == '' then return nil end
  return key
end
GloflyHttp.apiKey = apiKey

-- Waits for an HTTP answer (inside a thread / connecting handler). Gives up after `timeoutMs`.
local function request(url, method, body, headers, timeoutMs)
  local done, status, text = false, 0, nil
  PerformHttpRequest(url, function(code, resultText)
    done, status, text = true, code, resultText
  end, method, body or '', headers)
  local waited = 0
  while not done do
    Wait(50)
    waited = waited + 50
    if waited >= (timeoutMs or 8000) then return 0, nil end
  end
  return status, text
end

local function decode(text)
  if not text or text == '' then return nil end
  local ok, value = pcall(json.decode, text)
  if ok then return value end
  return nil
end

-- POST/GET to Glofly. Returns (status, table|nil).
function GloflyHttp.glofly(method, path, body)
  local key = apiKey()
  if not key then return -1, nil end
  local status, text = request(Config.ApiUrl .. path, method, body and json.encode(body) or '', {
    ['Authorization'] = 'Bot ' .. key,
    ['Content-Type'] = 'application/json',
    ['Accept'] = 'application/json',
    ['User-Agent'] = 'glofly-whitelist/1.0',
  })
  return status, decode(text)
end

-- Is this Discord user whitelisted (in the guild, with one of the roles)? true / false / nil (unknown)
function GloflyHttp.discordAllows(discordId)
  local token = GetConvar(Config.Discord.TokenConvar, '')
  if token == '' or (Config.Discord.GuildId or '') == '' or not discordId then return nil end
  local status, text = request(('https://discord.com/api/v10/guilds/%s/members/%s'):format(Config.Discord.GuildId, discordId), 'GET', '', {
    ['Authorization'] = 'Bot ' .. token,
    ['User-Agent'] = 'glofly-whitelist/1.0',
  })
  if status == 404 then return false end
  if status ~= 200 then return nil end
  local member = decode(text)
  if not member then return nil end
  if #(Config.Discord.RoleIds or {}) == 0 then return true end
  for _, have in ipairs(member.roles or {}) do
    for _, want in ipairs(Config.Discord.RoleIds) do
      if tostring(have) == tostring(want) then return true end
    end
  end
  return false
end
