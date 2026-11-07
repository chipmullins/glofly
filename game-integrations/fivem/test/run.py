"""
Glofly Whitelist test: runs the real resource (Lua 5.4 via `lupa`) with FiveM's server functions
faked, against a running Glofly dev server (default http://localhost:4000).

    pip install lupa
    GLOFLY_URL=http://localhost:4000 python3 game-integrations/fivem/test/run.py

Covers: start-up check, the link card + code, linking in Glofly then being let in on the next
check, ACE groups from roles, required roles, 'both' mode with Discord, and Glofly being down.
"""
import json, os, secrets, sys, urllib.request, urllib.error
from lupa import lua54

URL = os.environ.get("GLOFLY_URL", "http://localhost:4000")
HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "glofly-whitelist")
PW = "glofly-fivem-" + secrets.token_hex(4)
TAG = secrets.token_hex(3)

def call(path, method="GET", body=None, token=None, headers=None):
    h = {"content-type": "application/json", "x-glofly-version": "0.9.0", "x-glofly-features": "threads"}
    if token: h["authorization"] = f"Bearer {token}"
    h.update(headers or {})
    req = urllib.request.Request(URL + path, method=method, data=None if body is None else json.dumps(body).encode(), headers=h)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            t = r.read().decode(); return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode(); return e.code, (json.loads(t) if t else None)

def account(name):
    u = f"{name}{TAG}"
    s, j = call("/auth/register", "POST", {"email": f"{u}@example.com", "username": u, "displayName": name.title(), "password": PW, "birthday": "1995-05-14", "acceptTerms": True})
    assert s == 201, j
    return {"id": j["user"]["id"], "token": j["token"], "username": u}

# ── Glofly side: a constellation, a member, roles, a key that can link game servers ──
owner, player = account("fvowner"), account("fvplayer")
s, made = call("/constellations", "POST", {"name": f"Cozy RP {TAG}", "template": "blank"}, owner["token"]); assert s == 201, made
cid = made["constellation"]["id"]
s, link = call(f"/constellations/{cid}/links", "POST", {"lifetime": "7d"}, owner["token"])
call(f"/constellations/links/{link['link']['code']}/join", "POST", {}, player["token"])
roles = {}
for name in ["Police", "Whitelisted"]:
    s, r = call(f"/constellations/{cid}/roles", "POST", {"name": name, "color": "lagoon", "permissions": []}, owner["token"]); assert s == 201, r
    roles[name] = next(x["id"] for x in r["constellation"]["roles"] if x["name"] == name)
call(f"/constellations/{cid}/members/{player['id']}/roles", "PUT", {"roleIds": [roles["Police"]]}, owner["token"])
s, k = call(f"/constellations/{cid}/integrations/keys", "POST", {"name": "FiveM", "roleId": None, "scopes": ["link"], "lifetime": "never", "password": PW}, owner["token"]); assert s == 201, k
KEY = k["secret"]

# ── The fake FiveM server ──
L = lua54.LuaRuntime(unpack_returned_tuples=True)
G = L.globals()
state = {"convars": {"glofly_api_key": KEY, "gamename": "gta5"}, "commands": [], "events": [], "discord": None, "prints": []}

def to_py(v):
    if lua54.lua_type(v) == "table":
        keys = list(v.keys())
        if not keys: return []
        if all(isinstance(x, int) for x in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
            return [to_py(v[i]) for i in range(1, len(keys) + 1)]
        return {str(x): to_py(v[x]) for x in keys}
    return v

def to_lua(v):
    if isinstance(v, dict): return L.table_from({x: to_lua(y) for x, y in v.items()})
    if isinstance(v, list): return L.table_from([to_lua(x) for x in v])
    return v

def http(url, cb, method, body, headers):
    hd = to_py(headers) if headers else {}
    if url.startswith("https://discord.com/"):
        status, text = state["discord"] or (404, "")
        cb(status, text, L.table()); return
    try:
        req = urllib.request.Request(url, method=method or "GET", data=(body.encode() if body else None), headers=hd or {})
        with urllib.request.urlopen(req, timeout=10) as r: cb(r.status, r.read().decode(), L.table())
    except urllib.error.HTTPError as e: cb(e.code, e.read().decode(), L.table())
    except Exception: cb(0, None, L.table())

G.PerformHttpRequest = http
G.GetConvar = lambda name, d=None: state["convars"].get(name, d)
G.ExecuteCommand = lambda c: state["commands"].append(c)
G.print = lambda *a: state["prints"].append(" ".join(str(x) for x in a))
G.pyjson_encode = lambda t: json.dumps(to_py(t)) if lua54.lua_type(t) == "table" else json.dumps(t)
G.pyjson_decode = lambda s: to_lua(json.loads(s))
L.execute("""
json = { encode = function(t) return pyjson_encode(t) end, decode = function(s) return pyjson_decode(s) end }
HANDLERS, EXPORTS, THREADS = {}, {}, {}
function AddEventHandler(name, fn) HANDLERS[name] = fn end
function RegisterNetEvent(name, fn) if fn then HANDLERS[name] = fn end end
function TriggerEvent(name, ...) end
exports = setmetatable({}, { __call = function(_, name, fn) EXPORTS[name] = fn end })
function Wait(ms) coroutine.yield(ms or 0) end
RUN = {}
function CreateThread(fn) RUN[#RUN + 1] = coroutine.create(fn) end
function startConnecting(h, n, d) RUN[#RUN + 1] = coroutine.create(function() h(n, nil, d) end) end
function stepAll()
  for i = #RUN, 1, -1 do
    local co = RUN[i]
    local ok, err = coroutine.resume(co)
    if not ok then error(err) end
    if coroutine.status(co) == 'dead' then table.remove(RUN, i) end
  end
  return #RUN
end
PLAYERS = {}
function GetPlayerIdentifiers(src) return PLAYERS[src] and PLAYERS[src].ids or {} end
function GetPlayerName(src) return PLAYERS[src] and PLAYERS[src].name or nil end
""")
for f in ["config.lua", "server/http.lua", "server/card.lua", "server/main.lua"]:
    L.execute(open(os.path.join(RES, f), encoding="utf-8").read())
G.Config.ApiUrl = URL
G.Config.RecheckSeconds = 1

def run_threads(budget=4000):
    """Runs everything waiting to the end (fake time: every Wait is a step)."""
    steps = 0
    while steps < budget:
        steps += 1
        if G.stepAll() == 0: break
        if hooks.get("each"): hooks["each"]()
    return steps

hooks = {}
run_threads()
assert any("Ready for" in p for p in state["prints"]), state["prints"]

def connect(src, license, discord=None, choose=None):
    """One player connecting. Returns the deferral record."""
    rec = {"done": None, "cards": [], "updates": []}
    ids = [license] + ([f"discord:{discord}"] if discord else [])
    G.PLAYERS[src] = to_lua({"ids": ids, "name": "Riley"})
    def present(card, cb):
        rec["cards"].append(json.loads(card)); rec["cb"] = cb
        if choose: choose(rec)
    d = to_lua({})
    d.defer = lambda *a: None
    d.update = lambda *a: rec["updates"].append(a[-1])
    d.presentCard = lambda *a: present(a[-2], a[-1])
    def done(*a):
        rec["done"] = (a[-1] if a and isinstance(a[-1], str) else "")
    d.done = done
    G.source = src
    G.startConnecting(G.HANDLERS["playerConnecting"], "Riley", d)
    run_threads()
    return rec

LICENSE = "license:" + secrets.token_hex(20)
results = []
def check(name, cond, info=""):
    results.append((name, bool(cond))); print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  -> {info}"))

# 1. Not linked: the card with a code; link it in Glofly while waiting → let in, with groups.
G.Config.RoleGroups = to_lua({"Police": "group.police"})
linked = {}
def link_while_waiting():
    rec = hooks["rec"]
    if rec["cards"] and not linked:
        code = rec["cards"][0]["body"][2]["text"]
        s, j = call("/account/game-links", "POST", {"code": code}, player["token"])
        linked["status"] = (s, j)
rec = {"done": None, "cards": []}
hooks["rec"] = None
def chooser(r): hooks["rec"] = r
hooks["each"] = lambda: hooks["rec"] and link_while_waiting()
rec = connect(1, LICENSE, choose=chooser)
hooks["each"] = None
check("card shows a code", rec["cards"] and rec["cards"][0]["body"][2]["text"].count("-") == 1, rec["cards"][:1])
check("card names the community", rec["cards"] and f"Cozy RP {TAG}" in rec["cards"][0]["body"][0]["text"])
check("linking in Glofly worked", linked.get("status", (0,))[0] in (200, 201), linked)
check("let in after linking (no message)", rec["done"] == "", rec["done"])
check("ACE group from the Police role", any(c == f"add_principal identifier.{LICENSE} group.police" for c in state["commands"]), state["commands"])
check("export GetPlayer has the Glofly name", to_py(G.EXPORTS["GetPlayer"](1) or {}).get("user", {}).get("username") == player["username"])
check("export HasRole", G.EXPORTS["HasRole"](1, "police") is True)

# 2. Required role: Whitelisted missing → refused; given → let in.
G.Config.RequiredRoles = to_lua(["Whitelisted"])
rec = connect(2, LICENSE)
check("refused without the required role", rec["done"] and "Whitelisted" in rec["done"], rec["done"])
call(f"/constellations/{cid}/members/{player['id']}/roles", "PUT", {"roleIds": [roles["Police"], roles["Whitelisted"]]}, owner["token"])
state["commands"].clear()
rec = connect(3, LICENSE)
check("let in with the required role", rec["done"] == "", rec["done"])
check("old groups taken off before new ones", state["commands"][:1] == [f"remove_principal identifier.{LICENSE} group.police"], state["commands"])
G.Config.RequiredRoles = to_lua([])

# 3. Banned in Glofly → refused.
s, _ = call(f"/constellations/{cid}/members/{player['id']}/ban", "POST", {"reason": "test"}, owner["token"])
rec = connect(4, LICENSE)
check("banned player refused", rec["done"] == G.Config.Text.banned, rec["done"])

# 4. 'both' mode: an unlinked player whom Discord says yes to can press "Join with Discord instead".
G.Config.Mode = "both"
G.Config.Discord.GuildId = "123456789012345678"
state["convars"]["glofly_discord_token"] = "discord-test-token"
state["discord"] = (200, json.dumps({"roles": ["42"]}))
G.Config.Discord.RoleIds = to_lua(["42"])
def press_discord(r):
    if len(r["cards"]) == 1: r["cb"](to_lua({"glofly": "discord"}), "")
rec = connect(5, "license:" + secrets.token_hex(20), discord="111111111111111111", choose=press_discord)
check("both mode: card offers Discord", rec["cards"] and any(a.get("title") == "Join with Discord instead" for a in rec["cards"][0]["actions"]), rec["cards"][:1])
check("both mode: let in with Discord", rec["done"] == "", rec["done"])
state["discord"] = (404, "")
rec = connect(6, "license:" + secrets.token_hex(20), discord="222222222222222222", choose=lambda r: None)
check("both mode: no Discord button when Discord says no", rec["cards"] and all(a.get("title") != "Join with Discord instead" for a in rec["cards"][0]["actions"]), rec["cards"][:1])
G.Config.Mode = "glofly"

# 5. Glofly down → refused with the 'down' words (safe default).
G.Config.ApiUrl = "http://127.0.0.1:9"
rec = connect(7, LICENSE)
check("Glofly down: refused politely", rec["done"] == G.Config.Text.down, rec["done"])
G.Config.ApiUrl = URL

# Tidy up
call(f"/constellations/{cid}", "DELETE", {"name": f"Cozy RP {TAG}", "password": PW}, owner["token"])
failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
