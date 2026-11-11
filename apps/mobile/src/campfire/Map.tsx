import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing, runOnJS } from 'react-native-reanimated'
import Svg, { Circle, Defs, G, Line, Mask, Path, Pattern, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg'
import { Image } from 'expo-image'
import type { BuiltMap, BuiltTerrain, CharacterView, FogState, GridSettings, MapTheme, Point, Scene, TableState, Token } from '@glofly/shared'
import { gridFeet, nearestHexCenter } from '@glofly/shared'
import { sendLive } from '@/api/realtime'
import { Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { haptic } from '@/constellations/motion'
import { campfireApi, fileSource } from './api'
import { patchTable, useCampfire, type Ping } from './store'
import { barFraction, centerOf, controls, hpColor, initialOf, tokenColors, tokenName, useFire, useStill } from './lib'
import { HitLayer, useTokenFx } from './HitFx'
import { centerAt, costOf, mayDrag, setPlan, useFx, useMovePlan, useMovement, useSpeakingTokens, type Movement, type MovePlan } from './roundB'
import type { CampfireColors } from '@/ui/theme'

// The table's map (Phone board): the scene drawn in SVG (a built map or an uploaded picture, the
// grid, auras, fog), tokens on top, pan and pinch to look around, drag your own token (snaps to
// the grid on drop), tap someone to target them, long-press to ping a spot.
//
// Fog: players' apps never get what's hidden (the server leaves it out), so their fog is solid
// black over the picture; a GM sees it hatched, so they can still run the hidden part.

const THEME_BG: Record<MapTheme, string> = { stone: '#2B221D', wood: '#33251A', grass: '#1F2E1C', cave: '#1A1715', snow: '#AEB8BF', sand: '#5E4E33', night: '#11131D' }
const MATERIAL: Record<string, string> = { stone: '#5B4F46', wood: '#6E4A2F', grass: '#4F6B3A', water: '#3F7E92', sand: '#A08A5C', cave: '#3F4A4C', snow: '#D7DEE3', dirt: '#5E4A35' }
const OBJECT: Record<string, string> = {
  table: '#6E4A2F',
  chest: '#8B5A2B',
  crate: '#7A5A3A',
  door: '#8B5A2B',
  stairs: '#6B5D52',
  pillar: '#8A7D72',
  tree: '#3E6B35',
  campfire: '#F47A1F',
  trap: '#9C3A2F',
  statue: '#8A7D72',
}

/** A drag: where the finger has the token (x, y), where the drag began (startX/Y), where the token
 * really stands (originX/Y: a planned move starts from its end) and the corners picked on the way. */
type Drag = { id: string; x: number; y: number; startX: number; startY: number; originX: number; originY: number; path: Point[] }

export function CampfireMap({
  campaignId,
  table,
  meId,
  targetId,
  onTarget,
  bottomInset,
  rightInset = 0,
}: {
  campaignId: string
  table: TableState
  meId: string
  targetId: string | null
  onTarget: (tokenId: string | null) => void
  /** How much of the map the bottom sheet covers (the view centers above it) */
  bottomInset: number
  /** Width covered by the map buttons on the right: centering and "whole map" leave it free */
  rightInset?: number
}) {
  const fire = useFire()
  const scene = table.scene
  const [box, setBox] = useState({ w: 0, h: 0 })
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const sc = useSharedValue(1)
  /** A token is being dragged: the map itself doesn't pan meanwhile (web gets both gestures). */
  const tokenDrag = useSharedValue(0)
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<Drag | null>(null)
  const placed = useRef<string | null>(null)
  const pings = useCampfire((s) => s.pings[campaignId])
  const hits = useCampfire((s) => s.hits[campaignId])
  const gm = table.myRole === 'gm'
  const cell = scene?.grid.size ?? 70
  const W = scene?.widthPx ?? 1000
  const H = scene?.heightPx ?? 1000
  const current = table.combat?.current ?? null
  const mv = useMovement(table, meId)
  const planAll = useMovePlan((s) => s.plan)
  const plan = planAll && planAll.campaignId === campaignId && mv?.tokenId === planAll.tokenId ? planAll : null
  const speaking = useSpeakingTokens(table)
  const focus = useFx(campaignId).focus

  const minScale = box.w ? Math.min((box.w - rightInset) / W, (box.h - bottomInset) / H, 40 / cell) * 0.8 : 0.1
  const maxScale = (40 / cell) * 3.5

  /** Puts a map point in the middle of what's visible (above the bottom sheet). */
  const centerOn = useCallback(
    (x: number, y: number, s: number, animate: boolean) => {
      const nx = (box.w - rightInset) / 2 - x * s
      const ny = (box.h - bottomInset) / 2 - y * s
      if (animate) {
        tx.value = withTiming(nx, { duration: 260 })
        ty.value = withTiming(ny, { duration: 260 })
        sc.value = withTiming(s, { duration: 260 })
      } else {
        tx.value = nx
        ty.value = ny
        sc.value = s
      }
      setZoom(s)
    },
    [box.w, box.h, bottomInset, rightInset, tx, ty, sc],
  )

  const mine = useMemo(() => table.tokens.filter((t) => t.layer !== 'gm' && controls(t, meId, table.characters)), [table.tokens, table.characters, meId])
  // "Me" on the map: my PC's token (players: else any token I control; GMs control many, so none).
  const myMain = mine.find((t) => table.characters.some((c) => c.id === t.characterId && c.ownerId === meId)) ?? (gm ? undefined : mine[0])

  // First view of a scene: a cell about 40 pt wide, centered on my token (or the middle).
  useEffect(() => {
    if (!scene || !box.w || placed.current === scene.id) return
    placed.current = scene.id
    const s = Math.max(minScale, Math.min(maxScale, 40 / cell))
    const [x, y] = myMain ? centerOf(myMain, cell) : [W / 2, H / 2]
    centerOn(x, y, s, false)
  }, [scene, box.w, myMain, cell, W, H, minScale, maxScale, centerOn])

  // The game master moved everyone's view: go there (their own phone stays put).
  const focused = useRef(0)
  useEffect(() => {
    if (!focus || !scene || focus.sceneId !== scene.id || focus.at === focused.current || focus.by === meId) return
    focused.current = focus.at
    centerOn(focus.x, focus.y, Math.max(minScale, Math.min(maxScale, sc.value)), true)
  }, [focus, scene, meId, minScale, maxScale, centerOn, sc])

  // A plan whose token moved meanwhile (the game master, an Undo) or whose turn ended is dropped.
  useEffect(() => {
    if (!planAll || planAll.campaignId !== campaignId) return
    if (mv?.tokenId !== planAll.tokenId) setPlan(null)
  }, [planAll, mv?.tokenId, campaignId])
  const planFrom = useRef<{ x: number; y: number } | null>(null)
  const planTok = plan ? table.tokens.find((k) => k.id === plan.tokenId) : undefined
  useEffect(() => {
    if (!plan || !planTok) {
      planFrom.current = null
      return
    }
    if (!planFrom.current) planFrom.current = { x: planTok.x, y: planTok.y }
    else if (planFrom.current.x !== planTok.x || planFrom.current.y !== planTok.y) {
      planFrom.current = null
      setPlan(null)
    }
  }, [plan, planTok])

  // Browser preview: the mouse wheel zooms (phones pinch).
  const viewRef = useRef<View>(null)
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const el = viewRef.current as unknown as HTMLElement | null
    if (!el?.addEventListener) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const fx = e.clientX - rect.left
      const fy = e.clientY - rect.top
      const ns = Math.max(minScale, Math.min(maxScale, sc.value * Math.exp(-e.deltaY / 400)))
      const k = ns / sc.value
      tx.value = fx - (fx - tx.value) * k
      ty.value = fy - (fy - ty.value) * k
      sc.value = ns
      setZoom(ns)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [minScale, maxScale, sc, tx, ty])

  const ping = useCallback(
    (sx: number, sy: number) => {
      if (!scene) return
      const x = (sx - tx.value) / sc.value
      const y = (sy - ty.value) / sc.value
      if (x < 0 || y < 0 || x > W || y > H) return
      haptic.medium()
      void campfireApi.ping(campaignId, scene.id, x, y)
    },
    [scene, campaignId, W, H, tx, ty, sc],
  )

  const mapGesture = useMemo(() => {
    const keep = (s: number) => {
      'worklet'
      // Keep some of the map on screen.
      const margin = 80
      tx.value = Math.min(box.w - margin, Math.max(margin - W * s, tx.value))
      ty.value = Math.min(box.h - margin, Math.max(margin - H * s, ty.value))
    }
    const pan = Gesture.Pan()
      .minDistance(6)
      .averageTouches(true)
      .onChange((e) => {
        if (tokenDrag.value) return
        tx.value += e.changeX
        ty.value += e.changeY
        keep(sc.value)
      })
    const pinch = Gesture.Pinch()
      .onChange((e) => {
        const ns = Math.max(minScale, Math.min(maxScale, sc.value * e.scaleChange))
        const k = ns / sc.value
        tx.value = e.focalX - (e.focalX - tx.value) * k
        ty.value = e.focalY - (e.focalY - ty.value) * k
        sc.value = ns
        keep(ns)
      })
      .onEnd(() => {
        runOnJS(setZoom)(sc.value)
      })
    const press = Gesture.LongPress()
      .minDuration(450)
      .onStart((e) => {
        runOnJS(ping)(e.x, e.y)
      })
    const tap = Gesture.Tap().onEnd(() => {
      runOnJS(onTarget)(null)
    })
    return Gesture.Simultaneous(pinch, Gesture.Race(pan, press, tap))
  }, [box.w, box.h, W, H, minScale, maxScale, tx, ty, sc, ping, onTarget, tokenDrag])

  const world = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }] }))

  // Dragging my token: moves go out over the live connection (throttled), the drop snaps and saves.
  // The drag works from where the token was when it started (other moves meanwhile don't jump it).
  const lastSent = useRef(0)
  const dragRef = useRef<Drag | null>(null)
  const latest = useRef({ tokens: table.tokens, scene, cell, W, H, mv, plan, table })
  latest.current = { tokens: table.tokens, scene, cell, W, H, mv, plan, table }
  // Movement on your turn: rest your finger for a moment to turn a corner there.
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addCorner = useCallback(() => {
    const d = dragRef.current
    const { tokens: all, scene: sc0, mv: mv0 } = latest.current
    const t = d ? all.find((k) => k.id === d.id) : undefined
    if (!d || !t || !sc0 || mv0?.tokenId !== d.id) return
    const [x, y] = snap(sc0.grid, t, d.x, d.y)
    const c = centerAt(t, x, y, sc0.grid.size)
    const last = d.path[d.path.length - 1] ?? centerAt(t, d.originX, d.originY, sc0.grid.size)
    if (last[0] === c[0] && last[1] === c[1]) return
    if (d.path.length >= 40) return
    haptic.select()
    dragRef.current = { ...d, path: [...d.path, c] }
    setDrag(dragRef.current)
  }, [])
  const startDrag = useCallback((id: string) => {
    const { tokens: all, plan: p0, cell: c0 } = latest.current
    const t = all.find((k) => k.id === id)
    if (!t) return
    haptic.light()
    tokenDrag.value = 1
    // Dragging a planned move again carries on from its end (the corners so far are kept).
    const pl = p0?.tokenId === id ? p0 : null
    const from = pl ? { x: pl.x, y: pl.y } : { x: t.x, y: t.y }
    dragRef.current = {
      id,
      x: from.x,
      y: from.y,
      startX: from.x,
      startY: from.y,
      originX: t.x,
      originY: t.y,
      path: pl ? [...pl.path, centerAt(t, pl.x, pl.y, latest.current.scene?.grid.size ?? c0)] : [],
    }
    setDrag(dragRef.current)
  }, [tokenDrag])
  const moveDrag = useCallback(
    (id: string, dx: number, dy: number) => {
      const d = dragRef.current
      if (!d || d.id !== id) return
      const s = sc.value || 1
      const x = Math.round(d.startX + dx / s)
      const y = Math.round(d.startY + dy / s)
      dragRef.current = { ...d, x, y }
      setDrag(dragRef.current)
      if (linger.current) clearTimeout(linger.current)
      if (latest.current.mv?.tokenId === id) linger.current = setTimeout(addCorner, 450)
      const now = Date.now()
      // A planned move (your turn) isn't shown to the others until "Move here".
      if (latest.current.mv?.tokenId !== id && now - lastSent.current > 70) {
        lastSent.current = now
        sendLive('campfire:move', { tokenId: id, x, y })
      }
    },
    [sc, addCorner],
  )
  const endDrag = useCallback(
    (id: string, dx: number, dy: number) => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      tokenDrag.value = 0
      if (linger.current) clearTimeout(linger.current)
      const { tokens: all, scene: sc0, cell: c0, W: w0, H: h0, mv: mv0, table: tb0 } = latest.current
      const t = all.find((k) => k.id === id)
      if (!d || d.id !== id || !sc0 || !t) return
      const s = sc.value || 1
      const [x, y] = snap(sc0.grid, t, d.startX + dx / s, d.startY + dy / s)
      const cx = Math.max(-c0, Math.min(w0, x))
      const cy = Math.max(-c0, Math.min(h0, y))
      // Your turn: the move waits on the map until "Move here" (Undo drops it).
      if (mv0?.tokenId === id) {
        if (cx === d.originX && cy === d.originY) return setPlan(null)
        const size = sc0.grid.size
        const path = d.path.filter((pt, i, all2) => !(i === all2.length - 1 && pt[0] === centerAt(t, cx, cy, size)[0] && pt[1] === centerAt(t, cx, cy, size)[1]))
        const { cost, extra } = costOf(tb0, [centerAt(t, d.originX, d.originY, size), ...path, centerAt(t, cx, cy, size)])
        haptic.select()
        setPlan({ campaignId, tokenId: id, x: cx, y: cy, path, cost, extra })
        return
      }
      if (cx === d.startX && cy === d.startY) {
        sendLive('campfire:move', { tokenId: id, x: cx, y: cy })
        return
      }
      haptic.select()
      patchTable(campaignId, (tb) => ({ tokens: tb.tokens.map((k) => (k.id === id ? { ...k, x: cx, y: cy } : k)) }))
      void campfireApi.moveToken(id, cx, cy).then((r) => {
        // Refused (not yours any more, too fast): put it back where it was.
        if (!r.ok) patchTable(campaignId, (tb) => ({ tokens: tb.tokens.map((k) => (k.id === id ? { ...k, x: d.startX, y: d.startY } : k)) }))
      })
    },
    [sc, campaignId, tokenDrag],
  )

  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })

  if (!scene) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: fire.deep, borderRadius: 14, padding: 24 }}>
        <Text size={15} style={{ color: fire.muted, textAlign: 'center' }}>
          {gm ? 'Make a scene on a computer, then start it here.' : 'The game master hasn’t set out a map yet.'}
        </Text>
      </View>
    )
  }

  const draggingToken = drag ? table.tokens.find((t) => t.id === drag.id) : undefined
  const mvToken = mv ? table.tokens.find((t) => t.id === mv.tokenId) : undefined
  // The path being drawn (dragging on your turn) or waiting for "Move here".
  const live: { tk: Token; to: [number, number]; path: Point[] } | null =
    mvToken && drag?.id === mvToken.id ? { tk: mvToken, to: [drag.x, drag.y], path: drag.path } : mvToken && plan ? { tk: mvToken, to: [plan.x, plan.y], path: plan.path } : null
  const liveCost = live
    ? drag
      ? costOf(table, [centerAt(live.tk, live.tk.x, live.tk.y, cell), ...live.path, centerAt(live.tk, ...snap(scene.grid, live.tk, live.to[0], live.to[1]), cell)])
      : { cost: plan!.cost, extra: plan!.extra }
    : null
  const tokens = [...table.tokens].sort((a, b) => layerRank(a) - layerRank(b) || a.z - b.z)
  const recentPings = (pings ?? []).filter((p) => p.sceneId === scene.id)
  const pinger = recentPings.length ? recentPings[recentPings.length - 1] : null
  const pingerName = pinger ? (pinger.userId === meId ? 'You' : (table.members.find((m) => m.userId === pinger.userId)?.user?.displayName.split(' ')[0] ?? 'Someone')) : ''

  return (
    <View
      ref={viewRef}
      onLayout={onLayout}
      style={{ flex: 1, overflow: 'hidden', backgroundColor: fire.deep, borderRadius: 14 }}
      accessibilityLabel={`Map: ${scene.name}. Drag to look around, pinch to zoom, long-press to ping.`}
    >
      <GestureDetector gesture={mapGesture}>
        <View style={{ flex: 1 }} collapsable={false}>
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H, transformOrigin: '0 0' }, world]}>
            <SceneArt scene={scene} />
            {scene.built?.terrain?.length ? <TerrainLayer terrain={scene.built.terrain} w={W} h={H} fire={fire} /> : null}
            <FogLayer fog={scene.fog} w={W} h={H} gm={gm} fire={fire} />
            <AuraLayer tokens={table.tokens} cell={cell} feet={scene.grid.feet} w={W} h={H} />
            {tokens.map((t) => (
              <TokenView
                key={t.id}
                token={drag?.id === t.id ? { ...t, x: drag.x, y: drag.y } : plan?.tokenId === t.id ? { ...t, x: plan.x, y: plan.y } : t}
                canDrag={mayDrag(
                  table,
                  t,
                  mine.some((m) => m.id === t.id),
                )}
                speaking={speaking.has(t.id)}
                campaignId={campaignId}
                cell={cell}
                characters={table.characters}
                mine={mine.some((m) => m.id === t.id)}
                me={myMain?.id === t.id}
                active={current === t.id}
                targeted={targetId === t.id}
                gm={gm}
                zoom={zoom}
                onStart={startDrag}
                onMove={moveDrag}
                onEnd={endDrag}
                onTap={(id) => onTarget(id === targetId ? null : id)}
              />
            ))}
            {mv && mvToken ? <MoveLayer mv={mv} token={mvToken} cell={cell} feet={scene.grid.feet} live={live} over={!!liveCost && liveCost.cost > mv.left} zoom={zoom} w={W} h={H} /> : null}
            {drag && draggingToken && !live ? (
              <Measure
                from={centerOf({ ...draggingToken, x: drag.startX, y: drag.startY }, cell)}
                to={centerOf({ ...draggingToken, x: drag.x, y: drag.y }, cell)}
                grid={scene.grid}
                zoom={zoom}
                w={W}
                h={H}
              />
            ) : null}
            <PingLayer pings={recentPings} w={W} h={H} zoom={zoom} />
            <HitLayer hits={hits ?? []} tokens={table.tokens} cell={cell} zoom={zoom} />
          </Animated.View>
        </View>
      </GestureDetector>
      {pinger ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            left: 10,
            bottom: bottomInset + 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            height: 30,
            borderRadius: 15,
            backgroundColor: 'rgba(20,15,13,0.85)',
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fire.amber }} />
          <Text size={12} weight="bold" style={{ color: fire.ink }}>
            {pingerName} pinged a spot
          </Text>
        </View>
      ) : null}
      {live && liveCost && mv ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            left: 10,
            top: 10,
            maxWidth: box.w - 90,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: 'rgba(20,15,13,0.9)',
            borderWidth: 1,
            borderColor: liveCost.cost > mv.left ? fire.red : fire.amber,
          }}
        >
          <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 15, color: liveCost.cost > mv.left ? fire.red : fire.ink }}>
            {liveCost.cost} of {Math.max(0, mv.left)} ft
          </Text>
          {liveCost.extra > 0 ? (
            <Text size={12} style={{ color: fire.muted }}>
              {liveCost.extra} through difficult ground counts {liveCost.extra * 2}
            </Text>
          ) : liveCost.cost > mv.left ? (
            <Text size={12} style={{ color: fire.muted }}>
              {mv.dashed ? 'Too far for this turn' : 'Too far · Dash for more'}
            </Text>
          ) : null}
        </View>
      ) : null}
      {myMain ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Center the map on ${tokenName(myMain)}`}
          onPress={() => {
            const [x, y] = centerOf(myMain, cell)
            centerOn(x, y, Math.max(minScale, Math.min(maxScale, sc.value)), true)
          }}
          style={{
            position: 'absolute',
            right: 10,
            bottom: bottomInset + 10,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: 'rgba(20,15,13,0.85)',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: fire.line,
          }}
        >
          <Icon name="target" size={20} color={fire.ink} />
        </Pressable>
      ) : null}
    </View>
  )
}

const layerRank = (t: Token) => (t.layer === 'map' ? 0 : t.layer === 'gm' ? 1 : 2)

/** Where a token lands: on the grid (squares or hexes), by its top-left corner. */
export function snap(grid: GridSettings, t: Pick<Token, 'w' | 'h'>, x: number, y: number): [number, number] {
  const s = grid.size
  if (grid.type === 'hex') {
    const [cx, cy] = nearestHexCenter(x + (t.w * s) / 2, y + (t.h * s) / 2, grid)
    return [Math.round(cx - (t.w * s) / 2), Math.round(cy - (t.h * s) / 2)]
  }
  return [Math.round((x - grid.offsetX) / s) * s + grid.offsetX, Math.round((y - grid.offsetY) / s) * s + grid.offsetY]
}

/** Feet between two points: by cells moved (squares: a diagonal is one; hexes: steps), like desktop. */
export const feetBetween = (a: [number, number], b: [number, number], grid: GridSettings): number => gridFeet(a, b, grid)

const SceneArt = memo(function SceneArt({ scene }: { scene: Scene }) {
  const W = scene.widthPx
  const H = scene.heightPx
  const g = scene.grid
  return (
    <>
      <View style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: THEME_BG[scene.theme] ?? THEME_BG.stone }} />
      {scene.backgroundFileId ? (
        <Image
          source={fileSource(scene.backgroundFileId)}
          style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}
          contentFit="fill"
          cachePolicy="disk"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Defs>
          {g.type === 'square' ? (
            <Pattern id="cf-grid" patternUnits="userSpaceOnUse" x={g.offsetX} y={g.offsetY} width={g.size} height={g.size}>
              <Path d={`M ${g.size} 0 L 0 0 0 ${g.size}`} fill="none" stroke={g.color} strokeOpacity={g.opacity} strokeWidth={Math.max(1, g.size / 40)} />
            </Pattern>
          ) : null}
        </Defs>
        <Built built={scene.built} />
        {g.opacity > 0 ? g.type === 'square' ? <Rect x={0} y={0} width={W} height={H} fill="url(#cf-grid)" /> : <HexGrid grid={g} w={W} h={H} /> : null}
      </Svg>
    </>
  )
})

function Built({ built }: { built: BuiltMap }) {
  return (
    <G>
      {built.floors.map((f) => (
        <Polygon key={f.id} points={f.points.map((p) => p.join(',')).join(' ')} fill={MATERIAL[f.material] ?? MATERIAL.stone} stroke="#2B221D" strokeWidth={6} strokeLinejoin="round" />
      ))}
      {built.objects.map((o) => {
        const color = OBJECT[o.kind] ?? '#7A5A3A'
        const cx = o.x + o.w / 2
        const cy = o.y + o.h / 2
        const round = o.kind === 'pillar' || o.kind === 'tree' || o.kind === 'campfire'
        return (
          <G key={o.id} rotation={o.rotation} origin={`${cx}, ${cy}`}>
            {round ? (
              <Circle cx={cx} cy={cy} r={Math.min(o.w, o.h) / 2} fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth={3} />
            ) : (
              <Rect x={o.x} y={o.y} width={o.w} height={o.h} rx={4} fill={color} stroke="#4A301D" strokeWidth={2} strokeDasharray={o.kind === 'trap' ? '6 4' : undefined} />
            )}
            {o.kind === 'stairs' ? (
              <Path d={Array.from({ length: Math.max(1, Math.floor(o.w / 10)) }, (_, i) => `M ${o.x + i * 10 + 8} ${o.y} v ${o.h}`).join(' ')} stroke="#4C4139" strokeWidth={2} />
            ) : null}
          </G>
        )
      })}
      {built.walls.map((w) =>
        w.door ? (
          <Polyline
            key={w.id}
            points={w.points.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={w.door.state === 'locked' ? '#B4472F' : '#8B5A2B'}
            strokeWidth={w.door.state === 'open' ? 5 : 12}
            strokeDasharray={w.door.state === 'open' ? '10 8' : undefined}
            strokeLinecap="round"
          />
        ) : (
          <Polyline key={w.id} points={w.points.map((p) => p.join(',')).join(' ')} fill="none" stroke="#2B221D" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
        ),
      )}
    </G>
  )
}

function HexGrid({ grid, w, h }: { grid: GridSettings; w: number; h: number }) {
  const d = useMemo(() => {
    const cw = grid.size
    const ch = (grid.size * 2) / Math.sqrt(3)
    const parts: string[] = []
    const rows = Math.ceil(h / (0.75 * ch)) + 1
    const cols = Math.ceil(w / cw) + 1
    if (rows * cols > 6000) return '' // too many to draw on a phone
    for (let r = -1; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        const cx = grid.offsetX + c * cw + (r % 2 !== 0 ? cw / 2 : 0) + cw / 2
        const cy = grid.offsetY + r * 0.75 * ch + ch / 2
        const pts = [0, 1, 2, 3, 4, 5].map((i) => {
          const a = (Math.PI / 3) * i - Math.PI / 2
          return `${(cx + (ch / 2) * Math.cos(a)).toFixed(1)} ${(cy + (ch / 2) * Math.sin(a)).toFixed(1)}`
        })
        parts.push(`M ${pts.join(' L ')} Z`)
      }
    }
    return parts.join(' ')
  }, [grid, w, h])
  return d ? <Path d={d} fill="none" stroke={grid.color} strokeOpacity={grid.opacity} strokeWidth={Math.max(1, grid.size / 40)} /> : null
}

/** Fog of war: shapes apply in order, the latest covering a point decides (nothing = fogged). */
const FogLayer = memo(function FogLayer({ fog, w, h, gm, fire }: { fog: FogState; w: number; h: number; gm: boolean; fire: CampfireColors }) {
  if (!fog.enabled) return null
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      <Defs>
        <Mask id="cf-fog" maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
          <Rect x={0} y={0} width={w} height={h} fill="#fff" />
          {fog.revealed.map((s) => {
            const fill = s.mode === 'hide' ? '#fff' : '#000'
            if (s.kind === 'rect' && s.points.length >= 2) {
              const [[x1, y1], [x2, y2]] = s.points
              return <Rect key={s.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={fill} />
            }
            return <Polygon key={s.id} points={s.points.map((p) => p.join(',')).join(' ')} fill={fill} />
          })}
        </Mask>
        {gm ? (
          <Pattern id="cf-hatch" patternUnits="userSpaceOnUse" width={24} height={24} patternTransform="rotate(45)">
            <Rect x={0} y={0} width={24} height={24} fill="rgba(11,8,7,0.45)" />
            <Line x1={0} y1={0} x2={0} y2={24} stroke="rgba(255,179,71,0.35)" strokeWidth={6} />
          </Pattern>
        ) : null}
      </Defs>
      <Rect x={0} y={0} width={w} height={h} fill={gm ? 'url(#cf-hatch)' : fire.fog} mask="url(#cf-fog)" />
    </Svg>
  )
})

function AuraLayer({ tokens, cell, feet, w, h }: { tokens: Token[]; cell: number; feet: number; w: number; h: number }) {
  const auras = tokens.filter((t) => t.aura && t.aura.radiusFt > 0)
  if (!auras.length) return null
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      {auras.map((t) => {
        const [cx, cy] = centerOf(t, cell)
        const r = (t.aura!.radiusFt / Math.max(1, feet)) * cell + (t.w * cell) / 2
        return <Circle key={t.id} cx={cx} cy={cy} r={r} fill={t.aura!.color} fillOpacity={0.18} stroke={t.aura!.color} strokeOpacity={0.6} strokeWidth={2} />
      })}
    </Svg>
  )
}

/** Difficult ground and water from the map builder: hatched, like desktop's terrain tool. */
function TerrainLayer({ terrain, w, h, fire }: { terrain: BuiltTerrain[]; w: number; h: number; fire: CampfireColors }) {
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      <Defs>
        <Pattern id="cf-mud" width={14} height={14} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Rect width={14} height={14} fill="rgba(140,96,52,0.28)" />
          <Line x1={0} y1={0} x2={0} y2={14} stroke="rgba(255,179,71,0.45)" strokeWidth={3} />
        </Pattern>
        <Pattern id="cf-water" width={14} height={14} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Rect width={14} height={14} fill="rgba(63,126,146,0.3)" />
          <Line x1={0} y1={0} x2={0} y2={14} stroke="rgba(156,192,255,0.45)" strokeWidth={3} />
        </Pattern>
      </Defs>
      {terrain.map((a) => (
        <Polygon
          key={a.id}
          points={a.points.map((p) => p.join(',')).join(' ')}
          fill={`url(#${a.kind === 'water' ? 'cf-water' : 'cf-mud'})`}
          stroke={a.kind === 'water' ? fire.tempText : fire.amber}
          strokeOpacity={0.7}
          strokeWidth={2}
          strokeDasharray="8 6"
        />
      ))}
    </Svg>
  )
}

/** Your turn's movement: how far you can still go (and with Dash), and the path being planned. */
function MoveLayer({
  mv,
  token,
  cell,
  feet,
  live,
  over,
  zoom,
  w,
  h,
}: {
  mv: Movement
  token: Token
  cell: number
  feet: number
  live: { tk: Token; to: [number, number]; path: Point[] } | null
  over: boolean
  zoom: number
  w: number
  h: number
}) {
  const fire = useFire()
  const z = 1 / Math.max(0.05, zoom)
  const [cx, cy] = centerAt(token, token.x, token.y, cell)
  const px = (ft: number) => (Math.max(0, ft) / Math.max(1, feet)) * cell + (token.w * cell) / 2
  const pts: Point[] = live ? [[cx, cy], ...live.path, centerAt(token, live.to[0], live.to[1], cell)] : []
  const color = over ? fire.red : fire.amber
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      {mv.left > 0 ? <Circle cx={cx} cy={cy} r={px(mv.left)} fill="rgba(87,194,122,0.06)" stroke={fire.green} strokeWidth={2.5 * z} strokeDasharray={`${10 * z} ${7 * z}`} /> : null}
      {!mv.dashed ? <Circle cx={cx} cy={cy} r={px(mv.left + mv.speed)} fill="none" stroke={fire.amber} strokeOpacity={0.4} strokeWidth={1.5 * z} strokeDasharray={`${4 * z} ${8 * z}`} /> : null}
      {live ? (
        <>
          <Circle cx={cx} cy={cy} r={(token.w * cell) / 2 + 6 * z} fill="none" stroke={fire.amber} strokeWidth={2.5 * z} strokeDasharray={`${6 * z} ${5 * z}`} />
          <Polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={5 * z} strokeLinejoin="round" strokeLinecap="round" />
          {live.path.map((p, i) => (
            <Circle key={i} cx={p[0]} cy={p[1]} r={6 * z} fill={color} />
          ))}
          <Circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={7 * z} fill={color} />
        </>
      ) : null}
    </Svg>
  )
}

function Measure({ from, to, grid, zoom, w, h }: { from: [number, number]; to: [number, number]; grid: GridSettings; zoom: number; w: number; h: number }) {
  const fire = useFire()
  const ft = feetBetween(from, to, grid)
  const z = 1 / Math.max(0.05, zoom)
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      <Line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={fire.amber} strokeWidth={3 * z} strokeDasharray={`${10 * z} ${6 * z}`} />
      <Rect x={to[0] + 14 * z} y={to[1] - 30 * z} width={54 * z} height={22 * z} rx={8 * z} fill={fire.amber} />
      <SvgText x={to[0] + 41 * z} y={to[1] - 14 * z} fontSize={12 * z} fontFamily="Outfit_700Bold" fontWeight="700" fill={fire.accentInk} textAnchor="middle">
        {ft} ft
      </SvgText>
    </Svg>
  )
}

function PingLayer({ pings, w, h, zoom }: { pings: Ping[]; w: number; h: number; zoom: number }) {
  if (!pings.length) return null
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }}>
      {pings.map((p) => (
        <PingRing key={p.id} x={p.x} y={p.y} zoom={zoom} />
      ))}
    </View>
  )
}

function PingRing({ x, y, zoom }: { x: number; y: number; zoom: number }) {
  const fire = useFire()
  const still = useStill()
  const t = useSharedValue(0)
  useEffect(() => {
    t.value = still ? 0 : withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) })
  }, [t, still])
  const r = 36 / Math.max(0.05, zoom)
  const style = useAnimatedStyle(() => ({ opacity: still ? 0.9 : 1 - t.value * 0.8, transform: [{ scale: still ? 1 : 0.4 + t.value * 0.9 }] }))
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          borderWidth: 4 / Math.max(0.05, zoom),
          borderColor: fire.amber,
          backgroundColor: 'rgba(255,179,71,0.18)',
        },
        style,
      ]}
    />
  )
}

// ───────────── Tokens ─────────────

type TokenProps = {
  token: Token
  campaignId: string
  cell: number
  characters: CharacterView[]
  mine: boolean
  me: boolean
  active: boolean
  targeted: boolean
  gm: boolean
  zoom: number
  canDrag: boolean
  speaking: boolean
  onStart: (id: string) => void
  onMove: (id: string, dx: number, dy: number) => void
  onEnd: (id: string, dx: number, dy: number) => void
  onTap: (id: string) => void
}

const TokenView = memo(function TokenView({ token: t, campaignId, cell, characters, me, active, targeted, gm, zoom, canDrag, speaking, onStart, onMove, onEnd, onTap }: TokenProps) {
  const fire = useFire()
  const still = useStill()
  const w = t.w * cell
  const h = t.h * cell
  const { ring, fill, party } = tokenColors(t, characters, me)
  const hp = t.bars[0] ?? null
  const frac = barFraction(hp)
  const defeated = hp?.state === 'defeated' || (hp?.value === 0 && (hp?.max ?? 0) > 0) || t.conditions.includes('defeated') || t.conditions.includes('dead')
  const ch = t.characterId ? characters.find((c) => c.id === t.characterId) : undefined
  const image = t.imageFileId ?? ch?.portraitFileId ?? null
  const fx = useTokenFx(campaignId, t.id, cell, still)
  const ringW = Math.max(2, cell * 0.075)
  const showName = me || active || (gm && !!t.name)
  const label = `${tokenName(t)}${me ? ' (you)' : ''}${t.elevation ? `, ${t.elevation > 0 ? `${t.elevation} ft up` : `${-t.elevation} ft down`}` : ''}${t.locked ? ', locked' : ''}${speaking ? ', talking' : ''}${hp && hp.value !== null && hp.max !== null ? `, ${hp.value} of ${hp.max} hit points` : hp?.state ? `, ${hp.state}` : ''}${t.conditions.length ? `, ${t.conditions.join(', ')}` : ''}${active ? ', their turn' : ''}${targeted ? ', targeted' : ''}`

  // The gesture stays the same while dragging (the parent moves the token), so it never restarts.
  const calls = useRef({ onStart, onMove, onEnd, onTap })
  calls.current = { onStart, onMove, onEnd, onTap }
  const id = t.id
  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((_e, ok) => {
        if (ok) calls.current.onTap(id)
      })
    if (!canDrag) return tap
    const pan = Gesture.Pan()
      .runOnJS(true)
      .minDistance(4)
      .onStart(() => calls.current.onStart(id))
      .onUpdate((e) => calls.current.onMove(id, e.translationX, e.translationY))
      .onEnd((e) => calls.current.onEnd(id, e.translationX, e.translationY))
      .onFinalize((_e, ok) => {
        if (!ok) calls.current.onEnd(id, 0, 0)
      })
    return Gesture.Exclusive(pan, tap)
  }, [canDrag, id])

  const barW = useSharedValue(frac ?? 0)
  useEffect(() => {
    if (frac === null) return
    barW.value = still ? frac : withTiming(frac, { duration: 600, easing: Easing.out(Easing.cubic) })
  }, [frac, still, barW])
  const barStyle = useAnimatedStyle(() => ({ width: `${Math.round(barW.value * 100)}%` }))
  const z = 1 / Math.max(0.05, zoom)

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={canDrag ? 'Drag to move. Tap to target.' : 'Tap to target'}
        style={[{ position: 'absolute', left: t.x, top: t.y, width: w, height: h, opacity: defeated ? 0.4 : t.layer === 'gm' ? 0.6 : 1, zIndex: active || me ? 5 : 2 }, fx.style]}
      >
        <View
          style={{
            width: w,
            height: h,
            borderRadius: w / 2,
            backgroundColor: fill,
            borderWidth: ringW,
            borderColor: ring,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            boxShadow: active ? `0 0 ${cell * 0.45}px ${cell * 0.16}px ${fire.amberGlow}` : `0 ${cell * 0.08}px ${cell * 0.15}px rgba(0,0,0,0.6)`,
          }}
        >
          {image ? (
            <Image source={fileSource(image)} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="disk" />
          ) : party ? (
            // The boards' party faces: a skin-tone head over the color.
            <View style={{ position: 'absolute', top: h * 0.14, width: w * 0.44, height: w * 0.44, borderRadius: w, backgroundColor: '#E7C9A8' }} />
          ) : (
            <Text style={{ color: '#fff', fontFamily: 'Outfit_700Bold', fontSize: Math.round(h * 0.38) }}>{initialOf(t.name || 'M')}</Text>
          )}
        </View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: -ringW * 2, borderRadius: w, borderWidth: ringW * 1.4, borderColor: '#FFF6C8', opacity: 0 }, fx.glow]} />
        {speaking ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', inset: -ringW * 1.6, borderRadius: w, borderWidth: ringW, borderColor: fire.green, boxShadow: `0 0 ${cell * 0.3}px ${cell * 0.08}px ${fire.green}` }}
          />
        ) : null}
        {targeted ? <View pointerEvents="none" style={{ position: 'absolute', inset: -ringW * 2.5, borderRadius: w, borderWidth: ringW, borderColor: fire.red, borderStyle: 'dashed' }} /> : null}
        {frac !== null ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: cell * 0.05, right: cell * 0.05, bottom: -cell * 0.22, height: Math.max(3, cell * 0.12), borderRadius: cell, backgroundColor: 'rgba(0,0,0,0.7)' }}
          >
            <Animated.View
              style={[
                {
                  height: '100%',
                  borderRadius: cell,
                  backgroundColor: hp && hp.value !== null && hp.max ? hpColor(fire, hp.value, hp.max) : hp?.state === 'bloodied' ? fire.yellow : hp?.state === 'defeated' ? fire.red : fire.green,
                },
                barStyle,
              ]}
            />
          </View>
        ) : null}
        {t.conditions.length ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              right: -cell * 0.12,
              top: -cell * 0.12,
              minWidth: cell * 0.36,
              height: cell * 0.36,
              paddingHorizontal: cell * 0.06,
              borderRadius: cell,
              backgroundColor: fire.amber,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: fire.accentInk, fontFamily: 'Outfit_700Bold', fontSize: cell * 0.22 }}>{t.conditions.length > 1 ? t.conditions.length : initialOf(t.conditions[0])}</Text>
          </View>
        ) : null}
        {t.conditionTimers && Object.keys(t.conditionTimers).length ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              right: -cell * 0.14,
              top: cell * 0.26,
              height: cell * 0.28,
              paddingHorizontal: cell * 0.06,
              borderRadius: cell,
              backgroundColor: 'rgba(20,15,13,0.9)',
              borderWidth: 1,
              borderColor: fire.amberLine,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: fire.amber, fontFamily: 'Outfit_700Bold', fontSize: cell * 0.17 }}>{`${Math.min(...Object.values(t.conditionTimers))}r`}</Text>
          </View>
        ) : null}
        {t.elevation ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: -cell * 0.14,
              top: -cell * 0.14,
              height: cell * 0.32,
              paddingHorizontal: cell * 0.07,
              borderRadius: cell,
              backgroundColor: fire.concSoft,
              borderWidth: 1,
              borderColor: fire.concLine,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: fire.conc, fontFamily: 'Outfit_700Bold', fontSize: cell * 0.19 }}>{`${t.elevation > 0 ? '↑' : '↓'}${Math.abs(t.elevation)}`}</Text>
          </View>
        ) : null}
        {t.locked ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: -cell * 0.1,
              bottom: -cell * 0.05,
              width: cell * 0.3,
              height: cell * 0.3,
              borderRadius: cell,
              backgroundColor: 'rgba(20,15,13,0.9)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="lock" size={cell * 0.18} color={fire.ink} />
          </View>
        ) : null}
        {showName && t.name ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: h + cell * 0.3, left: -w, right: -w, alignItems: 'center' }}>
            <View style={{ paddingHorizontal: 6 * z, paddingVertical: 3 * z, borderRadius: 6 * z, backgroundColor: 'rgba(20,15,13,0.85)' }}>
              <Text numberOfLines={1} style={{ color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 11 * z }}>
                {t.name}
              </Text>
            </View>
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  )
})
