import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SignedInUser } from '../../../preload/api-types'
import type { MapTheme, MusicState, Point, Roll, Scene, Token } from '@glofly/shared/campfire/types'
import { MAP_THEMES } from '@glofly/shared/campfire/types'
import { useCalls } from '../calls/callState'
import { AvatarFace } from '../components/Avatar'
import { colorsFor } from '../lib/avatarColors'
import { cf, IMAGE_ACCEPT, pickFile, uploadFile } from './api'
import { CfContext, type Cf, type RollShare, type StatBlockFor, type Tab } from './ctx'
import { THEMES } from './geometry'
import MapView, { type FogBrush, type Tool } from './MapView'
import { useTable } from './useTable'
import { TurnOrder } from './TurnOrder'
import { DiceTray, RollsPanel } from './Rolls'
import { SheetPanel } from './Sheet'
import { SheetWindow } from './SheetWindow'
import { StatBlock } from './StatBlock'
import { HandoutsPanel } from './Handouts'
import { MusicPanel } from './Music'
import { useMusicPlayer } from './musicPlayer'
import { AddPanel } from './AddPanel'
import { ApprovalBox, DyingCard, RollCardOverlay, TokenCard } from './Overlays'
import Builder from './Builder'
import { Hub } from './Hub'
import { SetupWizard } from './SetupWizard'
import { HowCampfireWorks, Tour } from './Tour'
import { tourSeen } from './tourState'
import { PracticeTable } from './Practice'
import HiddenMenu from './HiddenMenu'
import { GmScreenPanel, GroupBar, MovementBar, SoundsPanel, TableBanners } from './TableB'
import {
  speakingGlowOn,
  useMovement,
  reachFor,
  useSoundPlayer,
  useSpeakingTokens,
  useWhisperKey
} from './tableHooks'
import { FlameIcon, Icon } from './icons'

// The table (Main board for game masters, Player board for players): header with who's at the
// table, the tool rail, the map, and the side panels (turn order, rolls, sheet, handouts, music,
// and for GMs "Add to the map"), with the dice tray under them.

export default function Table({
  campaignId,
  me,
  callId,
  placeName,
  setup,
  onLeave
}: {
  campaignId: string
  me: SignedInUser
  callId: string | null
  placeName?: string
  /** Just made: open the game master's setup */
  setup?: boolean
  onLeave: () => void
}): React.JSX.Element {
  const ctl = useTable(campaignId)
  const { t, error } = ctl
  if (error && !t)
    return (
      <div className="cf-empty">
        <p>{error}</p>
        <button type="button" className="cf-primary" onClick={onLeave}>
          Back
        </button>
      </div>
    )
  if (!t)
    return (
      <div className="cf-empty" role="status">
        <FlameIcon size={36} />
        <p>Lighting the campfire…</p>
      </div>
    )
  return (
    <TableReady
      ctl={ctl}
      me={me}
      callId={callId}
      placeName={placeName}
      setup={setup}
      onLeave={onLeave}
    />
  )
}

function TableReady({
  ctl,
  me,
  callId,
  placeName,
  setup,
  onLeave
}: {
  ctl: ReturnType<typeof useTable>
  me: SignedInUser
  callId: string | null
  placeName?: string
  setup?: boolean
  onLeave: () => void
}): React.JSX.Element {
  const t = ctl.t!
  const isGm = t.myRole === 'gm'
  const [hubOpen, setHubOpen] = useState(false)
  const [wizard, setWizard] = useState<1 | 2 | null>(setup && isGm ? 1 : null)
  const [touring, setTouring] = useState(() => !setup && !tourSeen(isGm))
  const [help, setHelp] = useState(false)
  const [practice, setPractice] = useState(false)
  // Round B
  const [multi, setMulti] = useState<string[]>([])
  const [whisperTo, setWhisperTo] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [fogMode, setFogMode] = useState<'reveal' | 'hide'>('reveal')
  const [fogBrush, setFogBrush] = useState<FogBrush>('box')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 0.11.2: a single click only selects a token; a double-click opens its card (menu)
  const [cardId, setCardId] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [share, setShare] = useState<RollShare>({ mode: 'all', to: [] })
  const [tab, setTab] = useState<Tab>(isGm ? 'turn' : 'sheet')
  const [message, setMessage] = useState<string | null>(null)
  const [builder, setBuilder] = useState<{ sceneId: string | null } | null>(null)
  const [asPlayer, setAsPlayer] = useState(false)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [statBlock, setStatBlock] = useState<StatBlockFor | null>(null)
  const [templateFt, setTemplateFt] = useState(20)
  const centerRef = useRef<(() => Point) | null>(null)
  const msgTimer = useRef<number | null>(null)
  const calls = useCalls()
  const music = useMusicPlayer(t.music, t.tracks, ctl.serverOffset)
  // Round B
  const movement = useMovement(t, me.id, isGm)
  const speaking = useSpeakingTokens(t, calls.room, calls.tick, speakingGlowOn())
  useSoundPlayer(ctl.live.sound)
  const multiSet = useMemo(() => new Set(multi), [multi])

  const say = useCallback((m: string) => {
    setMessage(m)
    if (msgTimer.current) window.clearTimeout(msgTimer.current)
    msgTimer.current = window.setTimeout(() => setMessage(null), 4500)
  }, [])
  const whispering = useWhisperKey(t.campaign.id, isGm ? calls.room : null, whisperTo, say)
  const { op: combatOp } = useCombat2(ctl, t.campaign.id, say)

  const names = useMemo(
    () => new Map(t.members.map((m) => [m.userId, m.user?.displayName ?? 'Someone'])),
    [t.members]
  )
  const nameOf = useCallback(
    (id: string | null) =>
      id ? (id === me.id ? 'You' : (names.get(id) ?? 'Someone')) : 'Game master',
    [names, me.id]
  )

  // GMs opening it from a call light it there ("Campfire is lit · Join" for everyone in the call).
  useEffect(() => {
    if (!isGm || !callId || t.campaign.openInCallId === callId) return
    void cf.post(`/campfire/campaigns/${t.campaign.id}/open`, { callId }).then((r) => {
      if (r.ok) ctl.update((s) => ({ ...s, campaign: { ...s.campaign, openInCallId: callId } }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGm, callId])

  // Pings say who pinged (while the ping shows).
  const lastPing = ctl.pings[ctl.pings.length - 1]
  const pingLine =
    lastPing && lastPing.userId !== me.id ? `${nameOf(lastPing.userId)} pinged a spot` : null
  const line = message ?? pingLine

  // Escape lets go of the selected token, its card and the target; T targets the selected token
  // (unless typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') {
        setSelectedId(null)
        setCardId(null)
        setTargetId(null)
      } else if (
        e.key.toLowerCase() === 't' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        selectedId
      ) {
        setTargetId((cur) => (cur === selectedId ? null : selectedId))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  const roll = useCallback(
    async (
      expression: string,
      opts: { label?: string; characterId?: string | null } = {}
    ): Promise<boolean> => {
      if (share.mode === 'whisper' && !share.to.length) {
        say('Pick who to whisper to (under the dice).')
        return false
      }
      const r = await cf.post<Roll>(`/campfire/campaigns/${t.campaign.id}/rolls`, {
        expression,
        ...(opts.label ? { label: opts.label.slice(0, 100) } : {}),
        ...(opts.characterId ? { characterId: opts.characterId } : {}),
        visibility: share.mode,
        ...(share.mode === 'whisper' ? { whisperTo: share.to } : {})
      })
      if (!r.ok) {
        say(r.message)
        return false
      }
      ctl.update((s) =>
        s.rolls.some((x) => x.id === r.data.id)
          ? s
          : { ...s, rolls: [r.data, ...s.rolls].slice(0, 200) }
      )
      return true
    },
    [share, t.campaign.id, ctl, say]
  )

  const pcIds = useMemo(
    () => new Set(t.characters.filter((c) => c.kind === 'pc').map((c) => c.id)),
    [t.characters]
  )
  const ownerOf = useMemo(() => new Map(t.characters.map((c) => [c.id, c.ownerId])), [t.characters])
  const controls = useCallback(
    (tk: Token) =>
      isGm ||
      tk.controlledBy.includes(me.id) ||
      (!!tk.characterId && ownerOf.get(tk.characterId) === me.id),
    [isGm, me.id, ownerOf]
  )
  const tokenOf = useCallback(
    (characterId: string) =>
      t.tokens.find((x) => x.characterId === characterId && x.layer !== 'map') ?? null,
    [t.tokens]
  )

  const cfv: Cf = {
    ctl,
    t,
    me,
    isGm,
    nameOf,
    say,
    message,
    selectedId,
    setSelectedId,
    targetId,
    setTargetId,
    share,
    setShare,
    roll,
    mapCenter: () => centerRef.current?.() ?? [0, 0],
    tokenOf,
    openTab: setTab,
    openBuilder: (sceneId) => setBuilder({ sceneId: sceneId ?? t.scene?.id ?? null }),
    openSheet: (id) => {
      setStatBlock(null)
      setSheetId(id)
    },
    openStatBlock: (what) => {
      if (!isGm) return
      setSheetId(null)
      setStatBlock(what)
    }
  }

  const scene = t.scene
  const combat = t.combat
  const currentToken = combat?.current ? t.tokens.find((x) => x.id === combat.current) : null
  const myTurn = !!currentToken && !isGm && controls(currentToken)
  // "Players move only on their turn": a player's token in the fight waits for its turn
  // (the server refuses the move too).
  const turnLocked = (tk: Token): boolean =>
    !isGm &&
    !!t.campaign.settings.moveOnTurn &&
    !!combat?.entries.length &&
    combat.entries.some((e) => e.tokenId === tk.id) &&
    combat.current !== tk.id
  const myPc = t.characters.find((c) => c.ownerId === me.id && c.kind === 'pc')
  const carded = cardId ? t.tokens.find((x) => x.id === cardId) : null
  const currentTrack = t.music ? t.tracks.find((x) => x.id === t.music!.trackId) : null

  const musicOp = async (body: Record<string, unknown>): Promise<void> => {
    const r = await cf.post<{ music: MusicState | null }>(
      `/campfire/campaigns/${t.campaign.id}/music`,
      body
    )
    if (!r.ok) say(r.message)
    else ctl.update((s) => ({ ...s, music: r.data.music }))
  }
  const patchScene = async (body: Record<string, unknown>): Promise<void> => {
    if (!scene) return
    const r = await cf.patch<Scene>(`/campfire/scenes/${scene.id}`, body)
    if (!r.ok) say(r.message)
    else
      ctl.update((s) => ({ ...s, scene: s.scene && s.scene.id === r.data.id ? r.data : s.scene }))
  }
  const fog = async (op: string, shape?: unknown): Promise<void> => {
    if (!scene) return
    const r = await cf.post(`/campfire/scenes/${scene.id}/fog`, { op, ...(shape ? { shape } : {}) })
    if (!r.ok) say(r.message)
  }

  const newScene = async (kind: 'upload' | 'build'): Promise<void> => {
    if (kind === 'build') {
      const r = await cf.post<Scene>(`/campfire/campaigns/${t.campaign.id}/scenes`, {
        name: `Scene ${t.scenes.length + 1}`,
        widthPx: 1400,
        heightPx: 980
      })
      if (!r.ok) return say(r.message)
      setBuilder({ sceneId: r.data.id })
      return
    }
    const file = await pickFile(IMAGE_ACCEPT)
    if (!file) return
    say('Uploading the map…')
    const up = await uploadFile(t.campaign.id, 'map', file)
    if (!up.ok) return say(up.message)
    const r = await cf.post<Scene>(`/campfire/campaigns/${t.campaign.id}/scenes`, {
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || `Scene ${t.scenes.length + 1}`,
      backgroundFileId: up.data.id,
      widthPx: Math.max(100, Math.min(20000, up.data.width ?? 1400)),
      heightPx: Math.max(100, Math.min(20000, up.data.height ?? 1000))
    })
    if (!r.ok) return say(r.message)
    say('Map ready.')
    if (t.campaign.activeSceneId)
      await cf.post(`/campfire/campaigns/${t.campaign.id}/scenes/${r.data.id}/activate`)
    ctl.reload()
  }

  if (builder && isGm) {
    return (
      <CfContext.Provider value={cfv}>
        <Builder sceneId={builder.sceneId} onClose={() => setBuilder(null)} />
      </CfContext.Provider>
    )
  }

  const rail: {
    id: Tool | 'draw' | 'scenes' | 'music'
    label: string
    icon: string
    gm?: boolean
  }[] = [
    { id: 'select', label: 'Select and move', icon: 'select' },
    { id: 'measure', label: 'Measure', icon: 'measure' },
    { id: 'ping', label: 'Ping', icon: 'ping' },
    { id: 'fog', label: 'Fog of war', icon: 'fog', gm: true },
    { id: 'draw', label: 'Map builder', icon: 'draw', gm: true },
    { id: 'template', label: 'Spell templates', icon: 'template' },
    { id: 'scenes', label: 'Maps and scenes', icon: 'image', gm: true },
    { id: 'music', label: 'Music and ambience', icon: 'music' }
  ]

  const tabs: { id: Tab; label: string }[] = isGm
    ? [
        { id: 'turn', label: 'Turn order' },
        { id: 'gm', label: 'GM screen' },
        { id: 'rolls', label: 'Rolls' },
        { id: 'sheet', label: 'Sheet' },
        { id: 'handouts', label: 'Handouts' },
        { id: 'music', label: 'Music' },
        { id: 'sounds', label: 'Sounds' },
        { id: 'add', label: 'Add' }
      ]
    : [
        { id: 'sheet', label: 'Sheet' },
        { id: 'rolls', label: 'Rolls' },
        { id: 'handouts', label: 'Handouts' },
        { id: 'music', label: 'Music' }
      ]

  const panel =
    tab === 'turn' ? (
      <TurnOrder withRolls />
    ) : tab === 'rolls' ? (
      <RollsPanel />
    ) : tab === 'sheet' ? (
      <SheetPanel />
    ) : tab === 'handouts' ? (
      <HandoutsPanel />
    ) : tab === 'music' ? (
      <MusicPanel />
    ) : tab === 'gm' ? (
      <GmScreenPanel
        onWhere={() => {
          const c = centerRef.current?.() ?? [0, 0]
          return { x: Math.round(c[0]), y: Math.round(c[1]) }
        }}
      />
    ) : tab === 'sounds' ? (
      <SoundsPanel room={calls.room} whisperTo={whisperTo} setWhisperTo={setWhisperTo} />
    ) : (
      <AddPanel />
    )

  const inCall = !!calls.current && !!calls.room
  const live = t.campaign.live
  const frozenForMe = !isGm && (!!live?.paused || !!t.campaign.settings.tokensLocked)
  const micOn = calls.room?.localParticipant.isMicrophoneEnabled ?? false

  return (
    <CfContext.Provider value={cfv}>
      <div className={`cf-table${isGm ? ' cf-table--gm' : ' cf-table--player'}`}>
        <header className="cf-head">
          <span className="cf-head-mark" aria-hidden="true">
            <FlameIcon size={20} />
          </span>
          <div className="cf-head-title">
            <h1>{t.campaign.name}</h1>
            <span>
              Campfire{placeName ? ` · ${placeName}` : ''} ·{' '}
              {isGm ? 'Game master view' : myPc ? `Playing as ${myPc.name}` : 'Player'}
            </span>
          </div>
          <ul className="cf-people" aria-label="At the table">
            {t.members.slice(0, 10).map((m) => {
              const [bg, fg] = colorsFor(m.userId)
              const here = t.present.includes(m.userId)
              return (
                <li
                  key={m.userId}
                  className={here ? 'cf-person cf-person--here' : 'cf-person'}
                  style={{ background: bg, color: fg }}
                  title={`${m.user?.displayName ?? 'Someone'}${m.role === 'gm' ? ' (game master)' : ''}${here ? '' : ' (away)'}`}
                >
                  <AvatarFace
                    id={m.userId}
                    name={m.user?.displayName ?? '?'}
                    avatarVersion={m.user?.avatarVersion}
                  />
                  <span className="cf-sr">
                    {m.user?.displayName}
                    {here ? ', at the table' : ', away'}
                  </span>
                </li>
              )
            })}
          </ul>
          {inCall && (
            <button
              type="button"
              className={micOn ? 'cf-round' : 'cf-round cf-round--off'}
              aria-label={micOn ? 'Mute' : 'Unmute'}
              aria-pressed={!micOn}
              onClick={calls.toggleMic}
            >
              <Icon name={micOn ? 'mic' : 'micOff'} size={18} />
            </button>
          )}
          {music.blocked && (
            <button type="button" className="cf-soft" onClick={music.resume}>
              ♫ Play the music
            </button>
          )}
          {isGm && t.campaign.openInCallId && (
            <button
              type="button"
              className="cf-ghost"
              title="Everyone in the call stops seeing the Join banner"
              onClick={async () => {
                const r = await cf.post(`/campfire/campaigns/${t.campaign.id}/close`)
                if (!r.ok) say(r.message)
                else ctl.update((s) => ({ ...s, campaign: { ...s.campaign, openInCallId: null } }))
              }}
            >
              Put out the campfire
            </button>
          )}
          <button
            type="button"
            className="cf-ghost cf-chats"
            title="Your Glofly chats (or move the mouse to the bottom edge)"
            onClick={() => window.dispatchEvent(new Event('glofly:dock-show'))}
          >
            <Icon name="chat" size={16} />
            Chats
          </button>
          <button
            type="button"
            className="cf-ghost"
            data-tour="hub"
            onClick={() => setHubOpen(true)}
          >
            Campaign hub
          </button>
          <button
            type="button"
            className="cf-round"
            aria-label="How Campfire works"
            title="How Campfire works"
            onClick={() => setHelp(true)}
          >
            ?
          </button>
          <button type="button" className="cf-leave" onClick={onLeave}>
            <Icon name="leave" size={16} />
            Leave table
          </button>
        </header>

        <div className="cf-body">
          <nav className="cf-rail" aria-label="Table tools">
            {rail
              .filter((r) => !r.gm || isGm)
              .map((r) => {
                const on = r.id === tool || (r.id === 'music' && tab === 'music')
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={on ? 'cf-rail-button cf-rail-button--on' : 'cf-rail-button'}
                    aria-label={r.label}
                    data-tour={r.id === 'fog' || r.id === 'draw' ? r.id : undefined}
                    aria-pressed={on}
                    title={r.label}
                    onClick={() => {
                      if (r.id === 'draw' || r.id === 'scenes')
                        setBuilder({ sceneId: scene?.id ?? null })
                      else if (r.id === 'music') setTab('music')
                      else setTool(r.id)
                    }}
                  >
                    <Icon name={r.icon} size={20} />
                  </button>
                )
              })}
          </nav>

          {!isGm && (
            <aside className="cf-left" aria-label="Turn order" data-tour="turn">
              <TurnOrder />
            </aside>
          )}

          <main className="cf-main" data-tour="map">
            <div className="cf-topbar">
              {combat && (
                <span className="cf-turn-pill">
                  {myTurn
                    ? `Your turn · Round ${combat.round}`
                    : `Round ${combat.round}${currentToken ? ` · ${currentToken.name}'s turn` : ''}`}
                </span>
              )}
              {myTurn && currentToken && (
                <span className="cf-sub">Drag {currentToken.name} to move</span>
              )}
              {isGm && t.scenes.length > 0 && (
                <label className="cf-topfield">
                  Scene
                  <select
                    value={t.campaign.activeSceneId ?? ''}
                    onChange={async (e) => {
                      const r = await cf.post(
                        `/campfire/campaigns/${t.campaign.id}/scenes/${e.target.value}/activate`
                      )
                      if (!r.ok) say(r.message)
                    }}
                  >
                    {t.scenes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {isGm && scene && !scene.backgroundFileId && (
                <label className="cf-topfield cf-theme">
                  <span className="cf-swatch" aria-hidden="true">
                    {THEMES[scene.theme].swatch.map((c) => (
                      <span key={c} style={{ background: c }} />
                    ))}
                  </span>
                  <span className="cf-sr">Map theme</span>
                  <select
                    aria-label="Map theme"
                    value={scene.theme}
                    onChange={(e) => void patchScene({ theme: e.target.value as MapTheme })}
                  >
                    {MAP_THEMES.map((m) => (
                      <option key={m} value={m}>
                        Map theme: {THEMES[m].label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {currentTrack && t.music && (
                <div className="cf-music-chip">
                  <Icon name="music" size={16} />
                  <span>
                    {currentTrack.title}
                    {!t.music.playing && <span className="cf-sub"> · paused</span>}
                  </span>
                  {isGm && (
                    <button
                      type="button"
                      aria-label={t.music.playing ? 'Pause music' : 'Play music'}
                      onClick={() => void musicOp({ op: t.music!.playing ? 'pause' : 'play' })}
                    >
                      {t.music.playing ? '❚❚' : '▶'}
                    </button>
                  )}
                </div>
              )}
              <span className="cf-spacer" />
              {tool === 'template' && (
                <label className="cf-topfield">
                  Radius
                  <select
                    value={templateFt}
                    onChange={(e) => setTemplateFt(Number(e.target.value))}
                  >
                    {[5, 10, 15, 20, 30, 40, 60].map((n) => (
                      <option key={n} value={n}>
                        {n} ft
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {isGm && scene && (
                <button
                  type="button"
                  className={tool === 'fog' ? 'cf-ghost cf-ghost--on' : 'cf-ghost'}
                  aria-pressed={tool === 'fog'}
                  onClick={() => setTool(tool === 'fog' ? 'select' : 'fog')}
                >
                  <Icon name="eye" size={16} />
                  {tool === 'fog' ? 'Done with fog' : 'Reveal area'}
                </button>
              )}
              {isGm && scene && (
                <HiddenMenu built={scene.built} onSave={(built) => void patchScene({ built })} />
              )}
              {isGm && scene && (
                <button
                  type="button"
                  className={asPlayer ? 'cf-ghost cf-ghost--on' : 'cf-ghost'}
                  aria-pressed={asPlayer}
                  onClick={() => setAsPlayer((v) => !v)}
                >
                  {asPlayer ? 'Back to GM view' : 'See as a player'}
                </button>
              )}
              {myTurn && (
                <button
                  type="button"
                  className="cf-primary"
                  onClick={() => void combatOp({ op: 'next' })}
                >
                  End my turn
                </button>
              )}
              {isGm && combat && (
                <button
                  type="button"
                  className="cf-primary"
                  onClick={() => void combatOp({ op: 'next' })}
                >
                  <Icon name="next" size={16} />
                  Next turn
                </button>
              )}
            </div>
            {tool === 'fog' && isGm && scene && (
              <div className="cf-fogbar" role="toolbar" aria-label="Fog of war">
                <span className="cf-sub">
                  {fogBrush === 'box'
                    ? 'Drag a box'
                    : fogBrush === 'lasso'
                      ? 'Draw around an area'
                      : 'Click corners, then Enter'}
                  {' · Shift: the other way'}
                </span>
                <div className="cf-seg" role="radiogroup" aria-label="Fog shape">
                  {(
                    [
                      ['box', 'Box'],
                      ['lasso', 'Freehand'],
                      ['points', 'Corners']
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={fogBrush === id}
                      className={fogBrush === id ? 'cf-chip cf-chip--on' : 'cf-chip'}
                      onClick={() => setFogBrush(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="cf-seg" role="radiogroup" aria-label="Fog brush">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={fogMode === 'reveal'}
                    className={fogMode === 'reveal' ? 'cf-chip cf-chip--on' : 'cf-chip'}
                    onClick={() => setFogMode('reveal')}
                  >
                    Reveal
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={fogMode === 'hide'}
                    className={fogMode === 'hide' ? 'cf-chip cf-chip--on' : 'cf-chip'}
                    onClick={() => setFogMode('hide')}
                  >
                    Hide
                  </button>
                </div>
                <button
                  type="button"
                  className="cf-ghost cf-small"
                  onClick={() => void fog('reset')}
                >
                  Fog everything
                </button>
                <button
                  type="button"
                  className="cf-ghost cf-small"
                  onClick={() => void fog('revealAll')}
                >
                  No fog
                </button>
              </div>
            )}
            {scene ? (
              <MapView
                scene={scene}
                tokens={t.tokens}
                isGm={isGm}
                asPlayer={asPlayer}
                isParty={(tk) =>
                  tk.controlledBy.length > 0 || (!!tk.characterId && pcIds.has(tk.characterId))
                }
                canMove={(tk) =>
                  controls(tk) &&
                  !turnLocked(tk) &&
                  !(!isGm && (frozenForMe || tk.locked)) &&
                  (tool === 'select' || tool === 'fog')
                }
                movement={
                  movement
                    ? {
                        tokenId: movement.tokenId,
                        left: movement.left,
                        dashExtra: movement.dashExtra
                      }
                    : null
                }
                speaking={speaking}
                reachOf={reachFor(t)}
                multi={isGm ? multiSet : undefined}
                onMulti={isGm ? setMulti : undefined}
                focus={
                  ctl.live.focus && ctl.live.focus.sceneId === scene.id ? ctl.live.focus : null
                }
                onLocked={(tk) =>
                  controls(tk) &&
                  turnLocked(tk) &&
                  say(`Not your turn yet: ${tk.name} moves on its turn.`)
                }
                diagonal={t.campaign.settings.diagonal}
                tool={tool}
                fogMode={fogMode}
                fogBrush={fogBrush}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id)
                  // Another token (or the empty map) closes an open card.
                  setCardId((c) => (c && c === id ? c : null))
                }}
                canOpen={(tk) => isGm || controls(tk)}
                onOpen={(id) => {
                  setSelectedId(id)
                  setCardId(id)
                }}
                targetId={targetId}
                onTarget={setTargetId}
                activeTokenId={combat?.current ?? null}
                onDragLive={(id, x, y) => window.glofly.campfire.move(id, x, y)}
                onDrop={async (id, x, y, path) => {
                  const tk = t.tokens.find((k) => k.id === id)
                  if (!tk || (tk.x === x && tk.y === y)) return
                  ctl.upsertToken({ ...tk, x, y })
                  const r = await cf.patch<Token>(`/campfire/tokens/${id}`, {
                    x,
                    y,
                    ...(path?.length
                      ? { path: path.map(([px, py]) => [Math.round(px), Math.round(py)]) }
                      : {})
                  })
                  if (!r.ok) {
                    say(r.message)
                    ctl.upsertToken(tk)
                  } else ctl.upsertToken(r.data)
                }}
                onPing={(x, y) =>
                  void cf
                    .post(`/campfire/campaigns/${t.campaign.id}/ping`, { sceneId: scene.id, x, y })
                    .then((r) => !r.ok && say(r.message))
                }
                onFogShape={(shape, mode) => void fog(mode, shape)}
                hits={ctl.hits}
                pings={ctl.pings}
                nameOf={nameOf}
                prevBars={ctl.prevBars}
                templateFt={templateFt}
                centerRef={centerRef}
              >
                <RollCardOverlay />
                {movement && tool === 'select' && <MovementBar />}
                {isGm && multi.length > 1 && <GroupBar ids={multi} onClear={() => setMulti([])} />}
                <TableBanners
                  fx={ctl.live}
                  onResume={() =>
                    void cf
                      .post(`/campfire/campaigns/${t.campaign.id}/pause`, { on: false })
                      .then((r) => !r.ok && say(r.message))
                  }
                />
                {whispering && whisperTo && (
                  <div className="cfb-banner cfb-banner--violet cfb-whisper" role="status">
                    <b>Whispering to {nameOf(whisperTo)}</b>
                    <span>Only they hear you while you hold V</span>
                  </div>
                )}
                {isGm && !asPlayer && <ApprovalBox />}
                {!isGm && <DyingCard />}
                {carded && tool === 'select' && (isGm || controls(carded)) && (
                  <TokenCard
                    key={carded.id}
                    token={carded}
                    targeted={targetId === carded.id}
                    onTarget={() => setTargetId((cur) => (cur === carded.id ? null : carded.id))}
                    onClose={() => setCardId(null)}
                  />
                )}
                {line && (
                  <div className="cf-toast" role="status">
                    <span className="cf-toast-dot" aria-hidden="true" />
                    {line}
                  </div>
                )}
              </MapView>
            ) : (
              <div className="cf-map cf-map--empty">
                {isGm ? (
                  <div className="cf-start-scene">
                    <h2 className="cf-h2">Set up the first scene</h2>
                    <p className="cf-hint">
                      Upload a battle map picture, or build one room by room.
                    </p>
                    <div className="cf-row-buttons">
                      <button
                        type="button"
                        className="cf-primary"
                        onClick={() => void newScene('upload')}
                      >
                        Upload a map image
                      </button>
                      <button
                        type="button"
                        className="cf-ghost"
                        onClick={() => void newScene('build')}
                      >
                        Build a map
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="cf-hint">Waiting for the game master to set out a map.</p>
                )}
                {message && (
                  <div className="cf-toast" role="status">
                    {message}
                  </div>
                )}
              </div>
            )}
          </main>

          <aside className="cf-side" aria-label="Table panels">
            <div className="cf-tabs" role="tablist" aria-label="Panels" data-tour="tabs">
              {tabs.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  data-tour={x.id === 'sheet' ? 'sheet' : x.id === 'turn' ? 'turn' : undefined}
                  aria-selected={tab === x.id}
                  className={tab === x.id ? 'cf-tab cf-tab--on' : 'cf-tab'}
                  onClick={() => setTab(x.id)}
                >
                  {x.label}
                  {x.id === 'handouts' && t.handouts.length > 0 && (
                    <span className="cf-tab-count">{t.handouts.length}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="cf-side-body" role="tabpanel">
              {panel}
            </div>
            <div data-tour="dice">
              <DiceTray />
            </div>
          </aside>
        </div>
        {sheetId && t.characters.some((c) => c.id === sheetId) && (
          <SheetWindow key={sheetId} characterId={sheetId} onClose={() => setSheetId(null)} />
        )}
        {hubOpen && (
          <Hub
            onClose={() => setHubOpen(false)}
            onSettings={() => {
              setHubOpen(false)
              setWizard(2)
            }}
          />
        )}
        {wizard && isGm && (
          <SetupWizard
            start={wizard}
            onClose={() => {
              setWizard(null)
              if (!tourSeen(true)) setTouring(true)
            }}
            onScene={(kind) => newScene(kind)}
          />
        )}
        {help && (
          <HowCampfireWorks
            onClose={() => setHelp(false)}
            onTour={() => {
              setHelp(false)
              setTouring(true)
            }}
            onPractice={() => {
              setHelp(false)
              setPractice(true)
            }}
          />
        )}
        {touring && !wizard && !hubOpen && !help && (
          <Tour
            onDone={() => setTouring(false)}
            onHelp={() => setHelp(true)}
            onPractice={() => {
              setTouring(false)
              setPractice(true)
            }}
          />
        )}
        {practice && !help && (
          <PracticeTable onClose={() => setPractice(false)} onHelp={() => setHelp(true)} />
        )}
        {statBlock && isGm && (
          <StatBlock
            key={'slug' in statBlock ? statBlock.slug : statBlock.characterId}
            what={statBlock}
            onClose={() => setStatBlock(null)}
          />
        )}
      </div>
    </CfContext.Provider>
  )
}

/** The combat route outside the context (the top bar's Next turn). */
function useCombat2(
  ctl: ReturnType<typeof useTable>,
  campaignId: string,
  say: (m: string) => void
): { op: (body: Record<string, unknown>) => Promise<void> } {
  return {
    op: async (body) => {
      const r = await cf.post<{ combat: NonNullable<typeof ctl.t>['combat'] }>(
        `/campfire/campaigns/${campaignId}/combat`,
        body
      )
      if (r.ok) ctl.update((s) => ({ ...s, combat: r.data.combat }))
      else say(r.message)
    }
  }
}
