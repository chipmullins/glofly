# Campfire: phase 1 spec (branch `campfire`)

Campfire is a virtual tabletop for 5e-style games inside Glofly calls, meant to replace Roll20 for a group
that already hangs out on Glofly. Built on the `campfire` branch only: never merge into `dev` until Chip says
so. "Campfire" is a working name; never call it "D&D" or "Dungeons & Dragons" anywhere users see
(Wizards of the Coast trademarks). Say "5e" or "fifth edition rules".

Approved look: the "Glofly Campfire (tabletop)" canvas, copied into `docs/design/campfire/*.dc.html`
(Main = game master view, Player = player view, Phone, Start = starting a table + roll card in chat,
Builder = map builder, Round = the animated combat round: attack → hit → damage → GM applies → bump/arrow
→ health bar drops). Keep screens matching those boards (dark call colors, Outfit + DM Sans).

Follow CLAUDE.md in the repo for everything else (add-only migrations, older apps keep working, restricted
family accounts, Lockdown, Pause gate, privacy policy for new data, shared code rules).

## Scope of phase 1

1. Campaigns that live in a constellation (opened from a voice nebula) or a group chat (opened from its
   call). Saved: next session picks up where it left off.
2. Scenes (pages): uploaded map image or a built map, square or hex grid (cell size in px, feet per cell),
   map theme, background music cue.
3. Layers: `map` (background objects), `tokens`, `gm` (only GMs see), plus the built map's own floors/walls/
   objects/notes.
4. Tokens: image or portrait, size in cells, rotation, three bars (value/max, who can see), conditions
   (5e list), aura (radius ft + color), name shown or hidden, who controls it.
5. Fog of war (manual): GM reveals/hides rectangles and polygons. Players' apps NEVER receive what's hidden:
   tokens whose center is in fog (except their own), `gm` layer tokens, GM notes, built-map pieces fully
   under fog. (An uploaded map image is sent whole; that's accepted for phase 1 and noted in the help text.)
6. Dice: Roll20-style expressions, rolled on the server (crypto RNG), shown to everyone, GM only, or
   whispered. Roll history per campaign. `/roll` works at the table and in any Glofly chat.
7. Turn tracker: add tokens, roll initiative for everyone (d20 + initiative bonus from the sheet, ties by
   dex then random), drag to reorder, next/previous turn, round counter, remove, end combat.
8. 5e character sheets with automation (PC and NPC): abilities, proficiency from level, saves, skills
   (proficient/expertise), AC, HP + temp HP, hit dice, speed, initiative, attacks, spells (slots by level,
   spell attack/save DC), class resources (short/long rest), death saves, conditions, concentration,
   inventory/features/notes, portrait, optional D&D Beyond link (opens the sheet; no import).
9. The hit flow from the Round board: attack roll vs target AC (players learn hit/miss, never the AC), damage
   roll (crits double the dice), pending damage that the GM approves/changes/skips (campaign setting
   "GM approves damage", default on), then apply: temp HP first, token HP bar + linked sheet, live
   `campfire:hit` event so every app animates the bump/arrow/spell, the floating number and the bar. Spells
   with saves: target save roll vs DC, half damage on success when the spell says so. Concentration check
   prompt (DC max(10, half damage)) when a concentrating creature takes damage. At 0 HP: PCs get death
   saves, NPCs show Defeated.
10. Monster stat blocks from the SRD (5.1, CC BY 4.0) to drop on the map ready to roll; spells list from
    the SRD for sheets. Credit line wherever the compendium shows: "Includes material from the System
    Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0."
11. Handouts (title, formatted text, optional image; shared with all, GM only, or chosen players) and a
    journal list.
12. Jukebox: GM uploads audio (mp3/ogg/m4a/wav, ≤ 20 MB each, ≤ 50 per campaign), plays/pauses/loops one
    track for the table, synced by server time; per-person volume and mute.
13. Map builder (desktop/web, GM only): draw rooms (rect/poly) with floor materials, walls (lines) with
    doors (open/closed/locked), drag objects from a palette, layers, GM notes, undo/redo, preview as a
    player, several scenes per campaign, start fogged, place monsters hidden.
14. Phones: join the table, watch the map (pan/zoom), move your own tokens, roll, your sheet, turn order,
    handouts, music. Running the game and building maps is desktop/web.

Not in phase 1: dynamic lighting/line of sight, macros, map imports, other game systems, card decks.

## Shared (`packages/shared/src/campfire/`, exported from the index)

- `types.ts`: every API type below.
- `dice.ts`: parser + roller. Grammar (case-insensitive, spaces ignored):
  - terms joined by `+`/`-`: `NdS` (N 1–100, default 1; S 2–1000, plus `d%` = d100 and `dF` = Fudge),
    numbers, and `(…)` groups; `*` and `/` (rounded down) with normal precedence.
  - modifiers after a dice term, any order: `khN`/`klN` keep highest/lowest, `dhN`/`dlN` drop, `!` explode
    (on max, cap 100 extra dice), `!>=N`, `rN`/`r<N`/`r>N` reroll forever (cap 100), `roN` reroll once,
    `>=N`/`>N`/`<N`/`<=N` success counting, `minN`/`maxN` clamp each die.
  - shorthands: `adv` = `2d20kh1`, `dis` = `2d20kl1`; inline `[[…]]` in chat text.
  - labels: anything after `#` or in `[brackets]` after a term is a label (`1d20+5 [Stealth] #sneaky`).
  - `parseDice(text) → { ok: true, expr } | { ok: false, error }` (friendly errors, max 200 chars, ≤ 100
    dice total after explosions, ≤ 20 terms); `rollDice(expr, rng)` → `RollResult` with every die
    (value, kept/dropped, exploded, rerolled, crit 20/fumble 1 flags on d20s), total and a plain-text
    breakdown `"1d20+7 → (14) + 7 = 21"`. `rng` is injected (server uses crypto).
- `rules5e.ts`: `abilityMod`, `profBonus(level)`, `saveBonus`, `skillBonus` (18 skills with abilities),
  `passivePerception`, `initiativeBonus`, `spellSaveDc`, `spellAttackBonus`, `attackExpressions(sheet,
  attack)` → `{ toHit: '1d20+7', damage: '1d8+4', critDamage: '2d8+4' }`, `applyDamage(hp, temp, amount,
  { resist?, vulnerable?, immune? })`, `heal`, `deathSave(roll, state)`, `shortRest`/`longRest` (resources,
  hit dice half back, slots), `concentrationDc(damage)`, `CONDITIONS` (the 15 5e conditions + exhaustion
  levels), `SPELL_SLOTS` table by caster level (full/half/pact), `XP`/CR table, `sizeCells`.
- `srd.ts` data is NOT in shared (too big): it's served by the server (see below).
- Tests in `test/shared.test.cjs` (dice grammar incl. bad input and limits, distributions with a seeded
  rng, rules math against known characters).

## Data (server migration `0058_campfire.sql`, generated by drizzle-kit, add-only)

- `campfire_campaigns`: id, name, constellation_id (nullable FK cascade), conversation_id (nullable FK
  cascade: the group chat for chat campaigns), created_by, active_scene_id, settings jsonb
  (`{ gmApprovesDamage: true, showMonsterHp: 'bloodied' | 'exact' | 'none', diceVisibility: 'all' }`),
  combat jsonb (null or `{ round, turn, entries: [{ tokenId, name, init, dex, hidden }] }`), music jsonb
  (null or `{ trackId, playing, startedAt, position, loop, volume }`), deleted_at, created_at, updated_at.
  One of constellation_id / conversation_id is set.
- `campfire_members`: campaign_id, user_id, role `gm` | `player`, joined_at (PK campaign+user).
- `campfire_scenes`: id, campaign_id, name, position, width_px, height_px, grid jsonb (`{ type: 'square' |
  'hex', size: 70, feet: 5, color, opacity, offsetX, offsetY }`), background_file_id, theme
  (`stone` | `wood` | `grass` | `cave` | `snow` | `sand` | `night`), built jsonb (map builder data:
  `{ floors: [{ id, points, material }], walls: [{ id, points, door?: { state: 'open' | 'closed' | 'locked' } }],
  objects: [{ id, kind, x, y, w, h, rotation }], notes: [{ id, x, y, text }] }`), fog jsonb (`{ enabled,
  revealed: [{ id, kind: 'rect' | 'poly', points }] }`), music_track_id, created_at, updated_at.
- `campfire_tokens`: id, scene_id, layer `map` | `tokens` | `gm`, character_id (nullable), name, image_file_id,
  x, y (px, top-left), w, h (cells), rotation, bars jsonb (3 × `{ value, max, color, show: 'all' | 'owner' | 'gm' }`),
  conditions text[], aura jsonb, show_name boolean, controlled_by uuid[], z, created_at, updated_at.
- `campfire_characters`: id, campaign_id, owner_id (nullable: NPCs belong to the GMs), kind `pc` | `npc`,
  name, portrait_file_id, sheet jsonb (`Sheet5e` in types), ddb_url, srd_monster (slug or null), created_at,
  updated_at.
- `campfire_rolls`: id, campaign_id, user_id, character_id, label, expression, result jsonb, total,
  visibility `all` | `gm` | `whisper`, whisper_to uuid[], created_at. Keep the newest 2,000 per campaign.
- `campfire_pending`: pending damage waiting for the GM: id, campaign_id, attacker_token_id,
  target_token_id, amount, damage_type, kind `melee` | `ranged` | `spell`, crit, created_by, created_at.
- `campfire_handouts`: id, campaign_id, title, body, image_file_id, shared `all` | `gm` | `some`,
  shared_with uuid[], created_by, created_at, updated_at.
- `campfire_files`: id, campaign_id, kind `map` | `token` | `portrait` | `handout` | `audio`, storage_key,
  mime, bytes, width, height, uploaded_by, created_at. Images re-encoded (strip metadata) like other photos.
- `campfire_tracks`: id, campaign_id, file_id, title, duration_sec, created_at.

Limits: 20 campaigns per constellation/chat, 30 scenes per campaign, 500 tokens per scene, 300 characters,
200 handouts, map images ≤ 25 MB and ≤ 8192 px a side, portraits/tokens ≤ 8 MB, audio as above, a
campaign's files ≤ 1 GB total. Rate limits in Redis (rolls 60/min per person, token moves 30/s per person).

## Who can do what (server-checked, `campfire/perms.ts`)

- Constellation campaigns: members of the constellation who can see the voice nebula it's opened from.
  New constellation permission `runGames` ("Run Campfire games": create campaigns and be a GM in any);
  Owner/admins have it. A campaign's creator is a GM; GMs can make other members GMs.
- Chat campaigns: members of the group chat; creator is GM; GMs can add GMs.
- GM: everything. Player: see what's not hidden, move tokens they control, edit their own characters
  (not HP max/AC locks if the GM locks sheets: `sheet.locked`), roll, see handouts shared with them,
  ping, measure, change their own volume.
- Restricted (family) accounts: can't create or join campaigns in constellations (constellations refuse
  them already); in group chats follow `groupBreaksRestriction` rules (only with family-approved people).
- Lockdown (`lockedDown`) blocks creating campaigns and posting rolls into chats. Frozen constellations:
  read-only. Pause gate: all routes mounted after it.

## API (`/campfire`, desktop main process allow-lists `/campfire/...`; web bridge the same)

All JSON unless noted. Errors use the app's usual `{ error, message }`.

- `GET /campfire/homes/:kind/:id/campaigns` (kind `nebula` = a voice nebula's conversation id, `chat` = a
  group chat id) → `{ campaigns: CampaignSummary[], canCreate }`.
- `POST /campfire/campaigns` `{ home: { kind, id }, name }` → `Campaign`.
- `GET /campfire/campaigns/:id` → `TableState` for this viewer (filtered: see fog rules): campaign,
  my role, members, scenes list, active scene (full, filtered), tokens (filtered), characters I can see
  (players: all PCs' public parts + their own full sheet; NPC sheets GM only), combat, music, pending damage
  (GM only), recent rolls (50, filtered), handouts list (filtered), tracks.
- `PATCH /campfire/campaigns/:id` (GM) name/settings. `DELETE` (GM creator or constellation admin).
- `POST /campfire/campaigns/:id/open` `{ callId }` → marks the table open in that call: everyone in the
  call gets `campfire:opened` (a "Campfire is lit · Join" banner); `POST …/close` (GM).
- `POST /campfire/campaigns/:id/presence` (every 30 s while the table is open in an app) → who's at the
  table; events go to the people at the table (+ GMs).
- Members: `PUT /campfire/campaigns/:id/members/:userId` `{ role }` (GM).
- Scenes: `POST /campfire/campaigns/:id/scenes`, `PATCH /campfire/scenes/:id` (name, grid, theme, size,
  built, fog, music), `DELETE`, `POST /campfire/campaigns/:id/scenes/:sceneId/activate` (moves everyone),
  `POST /campfire/scenes/:id/fog` `{ op: 'reveal' | 'hide' | 'reset' | 'revealAll', shape }`.
- Tokens: `POST /campfire/scenes/:id/tokens`, `PATCH /campfire/tokens/:id` (move: `{ x, y }` allowed for
  controllers; everything else GM, plus controllers may change their own bars/conditions), `DELETE`.
  Moves are also accepted over the socket (`campfire:move`, throttled) for smooth dragging; the HTTP route
  is the fallback.
- Characters: `POST /campfire/campaigns/:id/characters` (`{ kind, name, sheet?, srdMonster? }`), `GET/PATCH
  /campfire/characters/:id`, `DELETE`, `POST /campfire/characters/:id/rest` `{ kind: 'short' | 'long' }`.
- Files: `POST /campfire/campaigns/:id/files?kind=…&name=…` (raw body), `GET /campfire/files/:id` (access
  checked: members only; GM-only scenes' maps to GMs), `DELETE` (GM).
- Rolls: `POST /campfire/campaigns/:id/rolls` `{ expression, label?, characterId?, visibility, whisperTo? }`
  → `Roll`; `GET /campfire/campaigns/:id/rolls?before=` (history, filtered).
- Attacks: `POST /campfire/campaigns/:id/attack` `{ attackerTokenId, targetTokenId, attack: { name, toHit,
  damage, damageType, kind }, advantage?: 'adv' | 'dis' }` → rolls to hit and (if hit) damage on the
  server, creates pending damage (or applies at once if the campaign doesn't need approval).
  `POST …/save-spell` `{ casterTokenId, targetTokenIds, dc, ability, damage, half }` the same for save spells.
  `POST /campfire/pending/:id/apply` `{ amount? }` (GM), `POST /campfire/pending/:id/skip` (GM).
  `POST /campfire/tokens/:id/damage` `{ amount, type? }` / `…/heal` (GM; players for tokens they control).
- Combat: `POST /campfire/campaigns/:id/combat` `{ op: 'start' | 'add' | 'remove' | 'rollAll' | 'roll' |
  'set' | 'reorder' | 'next' | 'prev' | 'end', … }`.
- Handouts: CRUD under `/campfire/campaigns/:id/handouts` (GM writes; players read what's shared).
- Music: `POST /campfire/campaigns/:id/tracks` (after uploading the file), `DELETE /campfire/tracks/:id`,
  `POST /campfire/campaigns/:id/music` `{ op: 'play' | 'pause' | 'seek' | 'stop', trackId?, position?, loop?, volume? }`.
- Ping: `POST /campfire/campaigns/:id/ping` `{ sceneId, x, y }` (anyone at the table; 1 per second).
- Compendium (SRD): `GET /campfire/srd/monsters?q=` (name, CR, type, size), `GET /campfire/srd/monsters/:slug`
  (full stat block mapped to `Sheet5e`), `GET /campfire/srd/spells?q=&level=&class=`, `GET /campfire/srd/spells/:slug`.
  Data from the 5e-bits/5e-database SRD JSON (content CC BY 4.0), trimmed and committed under
  `apps/server/src/campfire/srd/*.json` with the credit line in a README there.
- `/roll` in chats: in the normal message send path, a message whose text starts with `/roll ` (and the
  sender isn't locked down) is rolled on the server and saved with an optional `roll` field
  (`{ expression, label, total, breakdown, dice }`) and a plain `body` like "🎲 Chip rolled 1d20+3: 17
  (14 + 3)" for older apps. Works in DMs, groups and nebulas (AutoMod still applies to the label).

## Live events (modern apps only: socket feature `campfire`; never sent to apps without it)

Sent per recipient after filtering (a player never gets hidden things):
`campfire:opened` / `campfire:closed` (call members), `campfire:state` (full refresh hint with `seq`),
`campfire:token` (upsert/delete; filtered: tokens moving into fog become `delete` for players, out of fog
`upsert`), `campfire:scene` (scene changed/activated), `campfire:fog`, `campfire:roll`, `campfire:pending`
(GMs), `campfire:hit` (`{ attackerTokenId, targetTokenId, amount, kind: 'melee' | 'ranged' | 'spell',
crit, defeated, bloodied }`, drives the animation), `campfire:combat`, `campfire:character` (owner + GMs;
others get the public part), `campfire:handout`, `campfire:music`, `campfire:ping`, `campfire:presence`.
Every event carries `campaignId` and a per-campaign `seq`; an app that sees a gap reloads `GET …/campaigns/:id`.

## Apps

- Desktop/web (`apps/desktop/src/renderer/src/campfire/`): opens as its own full layer from the call
  ("Campfire" in the call's activities menu, next to Watch Together) or the voice nebula header, and from the
  "Campfire is lit · Join" banner. Map in SVG with pan/zoom (wheel, drag, pinch on touch), tokens with drag,
  snap to grid, rulers, ping (Alt-click or long-press), the left tool rail, right panel tabs (Turn order,
  Rolls, Sheet, Handouts, Music), dice tray + `/roll` box, the GM approval box, the Round board's
  animations (bump, arrow, spell beam, shake, floating number, bar drop; Reduce Motion: no movement, a
  glow and the number). Map builder as its own screen for GMs. Main process: `campfire:request` allow-list
  (`^/campfire/...`), `campfire:upload` (file + kind), media through `glofly-media://campfire/<fileId>`.
- Phones (`apps/mobile/src/campfire/` + `src/app/(main)/campfire/[id].tsx`): the Phone board. react-native-svg
  map with gesture-handler pan/pinch, drag own token, bottom sheet (your turn, HP, actions, dice), sheet
  screen, turn order, rolls, handouts, music (expo-audio), the hit animations. JS only (no native code).
- Every app sends the `campfire` feature on its live connection so the server knows it can show Campfire.

## Privacy and terms

New data: campaign content, characters, rolls, uploaded maps/portraits/handouts/audio. Add to
`site/privacy.html` (what's stored, who sees it, deleted with the campaign or when the account is deleted)
and a terms line that people must have the rights to what they upload (music especially; DMCA applies).
Account deletion removes a person's characters' ownership (NPC-ify) and their uploads stay with the
campaign only if a GM keeps them (simplest: delete their uploaded files and characters). SRD credit line.

## Testing

Server e2e like the others (`test/campfire.e2e.ts`): permissions (player can't see GM layer, fogged tokens,
NPC sheets, GM rolls, AC), move rules, attack flow (hit/miss, crit doubles dice, pending/apply/skip,
temp HP, concentration prompt, death saves), combat order, files access, uploads limits, `/roll` in chat,
restricted accounts, Lockdown, Pause. Shared unit tests. Desktop/web: Playwright through the web build
against a local server (two windows: GM and player). Phones: the Expo web build (`npx expo export -p web`).

## Decisions (server + shared, Nov 9, 2026)

Where the spec was silent, the server does the simplest secure thing:

- **Data.** `campfire_campaigns.home_conversation_id` = the voice nebula's conversation a constellation
  campaign belongs to (needed for "can see the voice nebula"). Its home columns are `on delete set null`
  (not cascade): a campaign whose group chat / voice nebula / constellation is deleted becomes homeless,
  and the 10-minute sweep removes it with its stored files (a cascade would have left files in storage).
  `campfire_files.duration_sec` (music length from ffprobe). `messages.roll` jsonb for `/roll`.
- **Shared.** Besides types/dice/rules5e there's `campfire/map.ts` (fog geometry, `builtForPlayer`,
  `normalizeBuilt/Fog/Grid`), and `normalizeSheet` / `blankSheet` in rules5e: the server cleans every
  sheet, map and fog it's sent with these (unknown fields dropped, numbers clamped, lists capped).
- **Fog.** Shapes apply in order; a shape may carry `mode: 'hide'`; the latest shape covering a point
  decides (nothing covering it = fogged). `reveal`/`hide` add a shape (≤ 500), `reset` = fog on with
  nothing revealed, `revealAll` = fog off. Built pieces count as "fully under fog" when none of their
  sample points (corners, along edges, inside, the fog's own corners inside them) is visible: a barely
  uncovered piece may stay hidden (the safe side). Players get no `notes` at all.
- **Tokens.** Bar 0 is HP (from the linked sheet; new HP bars `show: 'all'`). An "NPC token" is any token
  not linked to a PC. For players who don't control it, `showMonsterHp` applies to bar 0: `exact` numbers,
  `bloodied` = `value`/`max` null with `state` (`healthy`/`bloodied`/`defeated`), `none` = no bar. Bars
  with `show: 'gm'` never reach players; `owner` only controllers (listed in `controlledBy`, or the linked
  PC's owner). Players get `characterId: null` on NPC tokens and `name: ''` when `showName` is off.
  Only GMs create/delete tokens in phase 1; players may change x/y, bar values and conditions of tokens
  they control (never who sees a bar, nor GM-only bars).
- **Hit flow.** A target without a sheet has AC 10. With `attack.id` naming one of the attacker's sheet
  attacks, the server works the expressions out from the sheet; otherwise it uses the app's (`toHit` must
  contain a d20). `advantage` replaces the first d20. Natural 20 always hits and doubles the damage dice
  (`critDice`), natural 1 always misses. A miss also sends `campfire:hit` with `miss: true, amount: 0`.
  `concentrationDc` in `campfire:hit` only goes to the target's controllers and GMs. NPCs at 0 HP get the
  token marker `defeated`; PCs get `unconscious`, and damage while at 0 adds death save failures (2 on a
  crit). The heal route doesn't heal the dead. GMs may send `visibility: 'gm'` on attack and save-spell
  rolls (the hit animation still shows the amount). Save spells: an NPC target's save roll is GM-only
  (players get its total without the breakdown), so monsters' save bonuses stay hidden.
- **Extra routes/events** (additive): `GET /campfire/scenes/:id` (GMs any scene, players the active one,
  `{ scene, tokens }`), `POST /campfire/characters/:id/death-save` (owner or GM; d20 rolled on the server),
  `POST …/presence { away: true }` (leave at once), `campfire:members` (role changes). `GET …/homes/…`
  also returns `why` (why `canCreate` is false).
- **Live events.** `seq` is per campaign *and per person* (everyone gets different events), kept in
  memory: a restart starts again at 1, which apps treat as a gap. Events go to the people at the table
  (a presence ping in the last 75 s) plus GMs who can be at it, re-checked every 5 s. "Lit in a call" is
  in memory too: only GMs light/close it, the call must be in the campaign's home and the GM in it;
  `campfire:opened` goes to everyone in the call who can be at the table.
- **Rolls.** GMs see every roll (whispers included). `diceVisibility: 'gm'` makes every player roll
  GM-only. 60 rolls a minute per person covers the table and `/roll` in chats together. History is kept
  to the newest 2,000 per campaign.
- **Turn order.** Players may only `roll` initiative for their own token; everything else is GM. GM-layer
  tokens join hidden; `set` takes `init` and/or `hidden`; reordering/removing keeps the turn with whoever
  had it; `start` without ids takes the active scene's `tokens` layer. Ties: Dexterity score, then a random
  tie-break kept for the session.
- **Files.** Players may upload `portrait` and `token` pictures; everything else is the GM's. Pictures
  are re-saved as WebP (maps up to 8192 px, tokens/portraits 1024, handout pictures 2048); music is copied
  by ffmpeg without tags or cover art (MP3/Ogg/M4A/WAV by their first bytes). Players may download: maps
  of the active scene, pictures of PCs' portraits or of tokens they can see right now, handout pictures
  shared with them, music that's a track, and anything they uploaded. Range requests are answered.
- **Campaigns.** In chats any group member may start one. Deleting: the creator (or, in a constellation,
  the Owner or anyone with "Edit constellation settings"), and it's removed for good at once (files
  included). Frozen constellations, timed-out members and accounts being deleted are read-only. Restricted
  accounts: refused in constellation campaigns; in chat campaigns the group's own rules already apply.
- **Characters.** Players make PCs for themselves only; NPCs and SRD monsters are GM-only. A locked sheet
  keeps its AC and HP max (and `locked`) when a player saves it. `ddbUrl` must be an https link on
  dndbeyond.com (or ddb.ac). Account removal deletes the person's characters and uploads (files too).
- **`/roll` in chats.** `/roll ` or `/r ` at the start. Locked-down senders get 403 `lockdown` (nothing
  is posted); a bad roll is 400 `invalid_roll` with the friendly error; roll messages can't be edited.
  Inline `[[…]]` in ordinary chat text is not rolled (so code and old messages never change);
  `parseDice` accepts a whole `[[…]]` and `inlineRolls(text)` finds them for the apps.
- **Older apps.** Apps that don't send `campfire` in `X-Glofly-Features` keep `runGames` as it was when
  they save a role (like `mentionEveryone`). Campfire apps should send that header on requests too.
- **Bodies.** `/campfire` reads its own JSON (512 KB; sheets ≤ 128 KB) after the sign-in check; the global
  10 KB parser skips it. Uploads are read only up to their kind's limit.

## Round A (Nov 10, 2026): rules choice, builder, switching over, hub, homebrew

Approved boards (copied into `docs/design/campfire/`): GmSetup, SwitchOver, CharBuilder, BuilderPhone,
LevelUp, Inventory, Hub, HubPhone, Homebrew, Tour. Keep screens matching them.

- **Rules per campaign.** `settings.rules` = `'2014'` (SRD 5.1) or `'2024'` (SRD 5.2); default 2014 for
  older campaigns. Every rules lookup sends `?rules=` (`/srd/monsters|spells|builder|items`). Show
  `creditFor(rules)` wherever rules text or the builder shows. Data: `tools/campfire-srd/build.mjs`
  (5e-database repo) writes `apps/server/src/campfire/srd/{2014,2024}/`.
- **Table settings.** `moveOnTurn` (server refuses a player's move off-turn: 403 `not_your_turn`; apps
  lock the drag and say so), `leveling` (`milestone` | `xp`), `diagonal` (`5` | `5-10`, ruler + reach).
- **Builder / level up.** Pure shared code (`builder.ts`): `buildSheet`, `levelUpPreview`/`levelUpSheet`,
  `finalScores`, `spellCounts`, `withHomebrew`, `sheetSpellFrom`. Class-table "X Subclass" rows are
  replaced by the subclass's own features. Desktop/web: 8 steps with ASIs/feats; phones: 8 steps with
  standard array and +2 ASIs (feats on a computer).
- **Switching over mid-campaign.** GM: setup step 1 "Continuing a campaign" → `POST /campaigns/:id/continue`
  (sessions before, party level, story so far = session 0 "Before Campfire", open quests). Players:
  import a character sheet PDF (desktop/web only: `importSheet.ts` reads the form fields with pdf-lib in
  the app; the PDF is never uploaded; spells and items matched to the rules), copy-in page (all apps),
  or build at the party's level. D&D Beyond is named only as a PDF source.
- **Hub** (`campfire/hub.ts`, migration 0059): sessions + RSVPs (+ reminders a day and 30 min before,
  `sweepSessionReminders`), recap drafts from what the server counted, quests, journal (hidden entries
  and GM notes never reach players), party loot (split/give), homebrew (shared or GM-only).
  Live event `campfire:hub` (allow-listed in desktop main and phones).
- **Inventory.** Optional `SheetItem` fields; equip → AC via `armorClassFromItems` (locked sheets keep
  AC), weapons from the rules add an attack, coins, attunement (3), carrying weight.
- **Tour.** First time per device (desktop/web localStorage, phones prefs); "?" on the table opens
  "How Campfire works". Coach marks point at real buttons (`data-tour`); no practice table yet.

## Round B (Nov 10, 2026): movement, the game master screen, table control, voice, sound board

Approved boards (in `docs/design/campfire/`): MoveDesktop, GmScreen, PhoneMove, PhonePaused, Voice,
Terrain. Keep screens matching them. Migration 0060 (add-only): `campfire_sounds`, `campaigns.live`,
`members.removed_at`, tokens `elevation` / `locked` / `condition_timers`.

- **Movement** (shared `roundB.ts`): `speedFor` (sheet speed; 0 with grappled/restrained/paralyzed/
  petrified/stunned/unconscious), `moveBudget` (Dash doubles), `pathCost` (square by square or hex by
  hex; painted terrain costs double; at most `MAX_PATH_STEPS` per path, past that it's "too far").
  The turn's entry keeps `moved`, `dashed`, `lastMove`, `anchor` (players get `moved`/`dashed` and a
  coordinate-free `lastMove`). Token PATCH takes `path` (token centers, ≤ 50, on the map). With
  "move on your turn" players are refused past their budget (`too_far`), re-checked under the
  campaign row lock (`noteMove`); live drags stop at the edge. A GM moving a player's token isn't
  charged to that player's turn. Combat ops `dash`, `undoMove` (one step; locked tokens can't undo),
  `legendary`. `startTurn` resets movement and legendary actions and ticks condition timers
  (`campfire:notice` "Poisoned ended on …" by the name each viewer sees).
- **Players can't take off** the no-move conditions (GM or their timer does). Locked sheets keep speed.
- **Terrain** (builder tool): `BuiltMap.terrain` (difficult / water). Players get only what isn't under
  fog, and their moves price fogged ground as plain.
- **GM screen** (desktop/web tab): encounter builder (SRD 5.2 XP budget for both rule sets: Low /
  Moderate / High; the 2014 DMG thresholds aren't in the SRD), Quick NPC, legendary actions, table
  controls (pause with a message, move everyone's view to a spot, lock all tokens, spotlight, remove
  someone / let them back). Group bar: box-select or Shift-click tokens, then damage / heal / save /
  condition / hide / lock for all.
- **Pause** (`campaigns.live.paused`): players get 423 `paused` for moves, rolls, attacks, damage,
  heal, death saves, rests and token changes; their map is covered (phones fold the sheet down).
- **Voice**: tokens glow while their player talks (per-device setting). Hold V (desktop/web GM) to
  whisper: LiveKit track permissions let only the chosen player hear; `campfire:whisper` tells the two.
- **Sound board**: 9 built-in sounds (`tools/sounds/campfire.py`, .ogg in desktop and mobile assets)
  plus up to 40 uploads (≤ 15 s, audio files cleaned like music). `POST /campaigns/:id/sound` plays
  for everyone (`campfire:sound`), at the GM's volume × each person's own.
- **Live events** (allow-listed in desktop main, web bridge and phones): `campfire:live`, `view`,
  `sound`, `whisper`, `notice`, `removed`.
- **Phones** (`src/campfire/roundB.ts`, `BoardB.tsx`): on your turn a drag draws a path (rest your
  finger to turn a corner), the cost pill shows "X of Y ft" (and difficult ground), the sheet shows
  Undo / Dash / Move here; nothing is sent until Move here. Paused cover, spotlight, moved-view,
  whisper and notice cards; sounds play; heights, locks and timers on tokens; terrain on the map.
- **Security review** (Nov 10, independent): fixed the unbounded path cost, movement races, GM moves
  charged to players, players lifting no-move conditions, pause gaps, fogged-terrain probing, hidden
  names in notices and the drag cache after removal. Accepted: players' unlocked sheets can still
  change their own speed (lock the sheet to stop it); removed players stay in the voice call.

## Round C (PROPOSAL, Nov 11, 2026; not approved, nothing built): lighting and vision, map imports, faster rolls

Boards (canvas "Glofly Campfire (tabletop)", Round C row at y=11420): C_WallsTool, C_DarkView, C_Lighting, C_Import,
C_QuickRoll, C_Tables, C_PhoneDark, C_PhoneQuick. When Chip approves, copy them into `docs/design/campfire/` and
change this heading to approved. Size: about 1.5–2× Round B. Migration 0061 (add-only).

### Decisions to confirm with Chip (proposed answers)
1. **"Players see"** defaults to *their own character* (GM can switch a campaign to *the whole party*).
2. **Existing scenes keep today's behavior** (manual fog only). Line of sight and lighting are per scene; new scenes
   start in Daylight with line of sight on; GM picks Darkness when it matters.
3. **Uploaded map pictures are still sent whole** to players (as with fog today): the darkness is drawn by the app,
   so the room layout of a picture is in the app's memory. Creatures, notes, doors' state, secret doors and built-map
   pieces outside what a player has seen are never sent. (Later option: send only explored tiles.)
4. **Walls and closed doors block movement** too (the Round B path check gains wall crossings).
5. Rollable tables ship with **Glofly-written starter tables** (the SRD has almost no random tables; no Wizards text).

### Data (migration 0061, add-only)
- `BuiltWall` gains `kind?: 'wall' | 'window' | 'invisible'` (window: blocks movement, not sight; invisible: blocks
  movement only) and `door?: { state, secret?: boolean, playersOpen?: boolean }`. Uploaded-map scenes use the same
  `built.walls` (walls without floors). `BuiltMap.lights?: { id, x, y, bright, dim, color, flicker, on }[]`.
- `campfire_scenes.lighting` jsonb: `{ mode: 'daylight' | 'dim' | 'dark', los: boolean, remember: boolean }`
  (null = Round B behavior). `campfire_files.tiles` jsonb: `{ size: 1024, cols, rows, overview }` for maps.
- `campfire_tokens.light` jsonb `{ bright, dim, color, from: 'sheet' | 'gm' }` and `vision` jsonb (override; normally
  from the sheet's senses / monster senses: darkvision, blindsight, truesight, tremorsense as blindsight on ground).
- Campaign `settings.partyVision: 'own' | 'party'`.
- `campfire_explored` (scene_id, user_id, bits bytea, updated_at; PK scene+user): one bit per square, set by the
  server only. 100×100 squares = 1.25 KB.
- `campfire_macros` (id, campaign_id, owner_id, character_id, name, icon, steps jsonb, message, visibility, pinned,
  position, timestamps). `campfire_tables` (id, campaign_id, name, dice, rows jsonb `[{ min, max, text, monster?,
  table? }]`, shared boolean, created_by, timestamps). `campfire_requests` (door pick/force asks: id, campaign_id,
  token_id, wall_id, kind, created_by, created_at; like `campfire_pending`).
- Limits: 5,000 wall pieces and 200 lights per scene, 100 macros per person per campaign (10 steps each), 200 tables
  per campaign (200 rows each, nesting 3 deep), imported files ≤ 60 MB.

### Vision (shared `packages/shared/src/campfire/vision.ts`, run on the server)
- `visibility(origin, segments)`: angle-sweep visibility polygon over sight-blocking segments (walls, windows don't
  block sight, closed/locked doors do, open doors don't), with a grid bucket index so a move costs a few ms at
  2,000 walls. Light polygons are cached per (scene walls version, light) and recomputed when walls/doors/lights or a
  carried light move.
- A point is **seen** by a character when it's inside their sight polygon and either lit (inside some light's polygon
  and radius, or the scene is Daylight/Dim), within darkvision (shown as dim, gray) or within blindsight/truesight.
  Blinded: only blindsight. A token is seen when its center or any of 4 inset points is seen.
- **Server-enforced**: `tokenVisible` gains the viewer's vision (union of their characters, or the party's), so every
  existing path (`emitToken`, `emitFog`, table state, combat list, hit events, notices, pings, measure) filters by it.
  Doors/walls/notes/built pieces outside explored squares are stripped for players; secret doors go out as plain walls.
- Each player gets `campfire:vision` `{ sceneId, shapes: { bright[], dim[], dark[] }, explored }` (polygons in map
  pixels; apps only draw them, they never compute sight). Sent when their sight changes (own move, door, light,
  condition, lighting change), throttled to 10/s during drags. GM "See as" = `GET .../scenes/:id/view-as/:userId`.
- Explored bits are set from what's seen (when `remember` is on); "Forget explored areas" clears them.

### Doors
- Players with `playersOpen` doors open/close them only when one of their tokens is within 5 ft (server-checked,
  paused tables refuse). Locked: "Locked" + Pick the lock / Force it → `campfire_requests` → the GM screen shows it,
  GM sets a DC; the player rolls (Thieves' tools / Athletics); GM opens or not.
- Door changes re-run vision for everyone on the scene (one `campfire:door` + `campfire:vision` per affected player).

### Imports (desktop/web)
- `.dd2vtt` / `.uvtt` / `.df2vtt` (Universal VTT JSON: `resolution`, `line_of_sight`, `objects_line_of_sight`,
  `portals`, `lights`, `environment`, base64 `image`). Read in the app; the picture uploads like any map
  (re-encoded, metadata stripped, scaled to ≤ 8192 px a side with a notice); the walls/doors/lights JSON is validated
  again on the server (counts, coordinates inside the map). Portals become doors as saved; windows aren't marked by
  every exporter, so the GM can switch a door to a window. A light's single range → dim radius, bright = half.
- **Tiles**: every map picture (imported or uploaded) gets 1024 px WebP tiles + a ≤ 2048 px overview at upload; phones
  load the overview, then the tiles on screen. Old maps get tiles the first time they're opened.

### Speed at the table
- **Quick-roll bar** (desktop/web bottom bar, phones a strip above the sheet): starts with the character's attacks,
  prepared spells and favorite skills; pin/unpin, drag to reorder, keys 1–9 (only while the table has focus; no
  clash with Space/W/V). Right-click / Shift / Ctrl (phones: long-press, or the Normal/Advantage/Disadvantage switch).
- **Macros**: steps (attack with an action, add damage dice on a hit, roll an expression, a check, a save, cast a
  spell at a level) + an optional message with `[[...]]` inline rolls. `@str…@cha` (mods), `@prof`, `@level`,
  `@spellmod`, `@spelldc` only, read from the roller's own sheet on the server. No scripts. Made on desktop/web;
  phones run them.
- **Rollable tables** (GM screen tab "Tables"): dice, ranges, `[[1d4]]` inside results, link a row to an SRD/homebrew
  monster (Place N hidden on the GM layer / Add to encounter) or to another table. Roll only me / for everyone;
  shared tables players can roll; `/table <name>` in the table chat or the group's Glofly chats (roll card + plain
  text for older apps, like `/roll`). Paste a list (one row per line) to make a table.

### Phones
- Dark view from `campfire:vision` shapes (one even-odd darkness path per kind: cheaper than masks on Android),
  remembered squares dimmed, tap a door within 5 ft → the door sheet, light a torch from inventory, quick-roll strip,
  macros run. Drawing walls, lights, imports and table editing stay on computers.

### Build order and checks
1. Shared `vision.ts` + unit tests (polygons, doors, windows, darkvision, blinded, party union) and a benchmark
   (2,000 walls, 20 lights, 6 players, 200 tokens: target < 15 ms per move).
2. Server: migration 0061, lighting/walls/lights/doors routes, `tokenVisible` with vision, `campfire:vision`,
   explored bits, door requests, walls blocking movement, See as. e2e tests for every "never sent" case.
3. Desktop/web: walls/doors/windows/lights tool, Lighting tab, See as, dark view, door popover, light a torch.
4. Phones: dark view, doors, tiles.
5. Imports + tiles (server tiler, desktop/web import flow), then quick-roll bar, macros, rollable tables (+ `/table`).
6. Playwright GM + player (desktop and 390 pt phone web build), independent security review (vision leaks, door
   adjacency, explored writes, import parsing/decoding limits, macro refs, table loops, rate limits), privacy page
   (explored areas, macros, tables, imported maps), project docs, report with screenshots.
