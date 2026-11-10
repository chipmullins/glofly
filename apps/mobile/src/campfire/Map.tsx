import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing, runOnJS } from 'react-native-reanimated'
import Svg, { Circle, Defs, G, Line, Mask, Path, Pattern, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg'
import { Image } from 'expo-image'
import type { BuiltMap, CharacterView, FogState, GridSettings, MapTheme, Scene, TableState, Token } from '@glofly/shared'
import { sendLive } from '@/api/realtime'
import { Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { haptic } from '@/constellations/motion'
import { campfireApi, fileSource } from './api'
import { patchTable, useCampfire, type Ping } from './store'
import { barFraction, centerOf, controls, hpColor, initialOf, tokenColors, tokenName, useFire, useStill } from './lib'
import { HitLayer, useTokenFx } from './HitFx'
import type { CampfireColors } from '@/ui/theme'

// The table's map (Phone board): the scene drawn in SVG (a built map or an uploaded picture, the
// grid, auras, fog), tokens on top, pan and pinch to look around, drag your own token (snaps to
// the grid on drop), tap someone to target them, long-press to ping a spot.
//
// Fog: players' apps never get what's hidden (the server leaves it out), so their fog is solid
// black over the picture; a GM sees it hatched, so they can still run the hidden part.

const THEME_BG: Record<MapTheme, string> = { stone: '#2B221D', wood: '#33251A', grass: '#1F2E1C', cave: '#1A1715', snow: '#AEB8BF', sand: '#5E4E33', night: '#11131D' }
const MATERIAL: Record<string, string> = { stone: '#5B4F46', wood: '#6E4A2F', grass: '#4F6B3A', water: '#3F7E92', sand: '#A08A5C', cave: '#3F4A4C', snow: '#D7DEE3', dirt: '#5E4A35' }
const OBJECT: Record<string, string> = { table: '#6E4A2F', chest: '#8B5A2B', crate: '#7A5A3A', door: '#8B5A2B', stairs: '#6B5D52', pillar: '#8A7D72', tree: '#3E6B35', campfire: '#F47A1F', trap: '#9C3A2F', statue: '#8A7D72' }

type Drag = { id: string; x: number; y: number; startX: number; startY: number }

export function CampfireMap({
  campaignId,
  table,
  meId,
  targetId,
  onTarget,
  bottomInset,
}: {
  campaignId: string
  table: TableState
  meId: string
  targetId: string | null
  onTarget: (tokenId: string | null) => void
  /** How much of the map the bottom sheet covers (the view centers above it) */
  bottomInset: number
}) {
  const fire = useFire()
  const scene = table.scene
  const [box, setBox] = useState({ w: 0, h: 0 })
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const sc = useSharedValue(1)
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

  const minScale = box.w ? Math.min(box.w / W, (box.h - bottomInset) / H, 40 / cell) * 0.8 : 0.1
  const maxScale = (40 / cell) * 3.5

  /** Puts a map point in the middle of what's visible (above the bottom sheet). */
  const centerOn = useCallback(
    (x: number, y: number, s: number, animate: boolean) => {
      const nx = box.w / 2 - x * s
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
    [box.w, box.h, bottomInset, tx, ty, sc],
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
  }, [box.w, box.h, W, H, minScale, maxScale, tx, ty, sc, ping, onTarget])

  const world = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }] }))

  // Dragging my token: moves go out over the live connection (throttled), the drop snaps and saves.
  // The drag works from where the token was when it started (other moves meanwhile don't jump it).
  const lastSent = useRef(0)
  const dragRef = useRef<Drag | null>(null)
  const latest = useRef({ tokens: table.tokens, scene, cell, W, H })
  latest.current = { tokens: table.tokens, scene, cell, W, H }
  const startDrag = useCallback((id: string) => {
    const t = latest.current.tokens.find((k) => k.id === id)
    if (!t) return
    haptic.light()
    dragRef.current = { id, x: t.x, y: t.y, startX: t.x, startY: t.y }
    setDrag(dragRef.current)
  }, [])
  const moveDrag = useCallback(
    (id: string, dx: number, dy: number) => {
      const d = dragRef.current
      if (!d || d.id !== id) return
      const s = sc.value || 1
      const x = Math.round(d.startX + dx / s)
      const y = Math.round(d.startY + dy / s)
      dragRef.current = { ...d, x, y }
      setDrag(dragRef.current)
      const now = Date.now()
      if (now - lastSent.current > 70) {
        lastSent.current = now
        sendLive('campfire:move', { tokenId: id, x, y })
      }
    },
    [sc],
  )
  const endDrag = useCallback(
    (id: string, dx: number, dy: number) => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      const { tokens: all, scene: sc0, cell: c0, W: w0, H: h0 } = latest.current
      const t = all.find((k) => k.id === id)
      if (!d || d.id !== id || !sc0 || !t) return
      const s = sc.value || 1
      const [x, y] = snap(sc0.grid, t, d.startX + dx / s, d.startY + dy / s)
      const cx = Math.max(-c0, Math.min(w0, x))
      const cy = Math.max(-c0, Math.min(h0, y))
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
    [sc, campaignId],
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
  const tokens = [...table.tokens].sort((a, b) => layerRank(a) - layerRank(b) || a.z - b.z)
  const recentPings = (pings ?? []).filter((p) => p.sceneId === scene.id)
  const pinger = recentPings.length ? recentPings[recentPings.length - 1] : null
  const pingerName = pinger ? (pinger.userId === meId ? 'You' : (table.members.find((m) => m.userId === pinger.userId)?.user?.displayName.split(' ')[0] ?? 'Someone')) : ''

  return (
    <View ref={viewRef} onLayout={onLayout} style={{ flex: 1, overflow: 'hidden', backgroundColor: fire.deep, borderRadius: 14 }} accessibilityLabel={`Map: ${scene.name}. Drag to look around, pinch to zoom, long-press to ping.`}>
      <GestureDetector gesture={mapGesture}>
        <View style={{ flex: 1 }} collapsable={false}>
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H, transformOrigin: '0 0' }, world]}>
            <SceneArt scene={scene} />
            <FogLayer fog={scene.fog} w={W} h={H} gm={gm} fire={fire} />
            <AuraLayer tokens={table.tokens} cell={cell} feet={scene.grid.feet} w={W} h={H} />
            {tokens.map((t) => (
              <TokenView
                key={t.id}
                token={drag?.id === t.id ? { ...t, x: drag.x, y: drag.y } : t}
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
            {drag && draggingToken ? <Measure from={centerOf({ ...draggingToken, x: drag.startX, y: drag.startY }, cell)} to={centerOf({ ...draggingToken, x: drag.x, y: drag.y }, cell)} grid={scene.grid} zoom={zoom} w={W} h={H} /> : null}
            <PingLayer pings={recentPings} w={W} h={H} zoom={zoom} />
            <HitLayer hits={hits ?? []} tokens={table.tokens} cell={cell} zoom={zoom} />
          </Animated.View>
        </View>
      </GestureDetector>
      {pinger ? (
        <View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', left: 10, bottom: bottomInset + 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: 'rgba(20,15,13,0.85)' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fire.amber }} />
          <Text size={12} weight="bold" style={{ color: fire.ink }}>
            {pingerName} pinged a spot
          </Text>
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
          style={{ position: 'absolute', right: 10, bottom: bottomInset + 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(20,15,13,0.85)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: fire.line }}
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
    const w = s
    const h = (s * 2) / Math.sqrt(3)
    const cx = x + (t.w * s) / 2 - grid.offsetX
    const cy = y + (t.h * s) / 2 - grid.offsetY
    let best: [number, number] = [cx, cy]
    let bestD = Infinity
    const row0 = Math.round((cy - h / 2) / (0.75 * h))
    for (let row = row0 - 1; row <= row0 + 1; row++) {
      const shift = row % 2 !== 0 ? w / 2 : 0
      const col = Math.round((cx - shift - w / 2) / w)
      const px = col * w + shift + w / 2
      const py = row * 0.75 * h + h / 2
      const d = (px - cx) ** 2 + (py - cy) ** 2
      if (d < bestD) {
        bestD = d
        best = [px, py]
      }
    }
    return [Math.round(best[0] + grid.offsetX - (t.w * s) / 2), Math.round(best[1] + grid.offsetY - (t.h * s) / 2)]
  }
  return [Math.round((x - grid.offsetX) / s) * s + grid.offsetX, Math.round((y - grid.offsetY) / s) * s + grid.offsetY]
}

/** 5e distance: the longer of the two directions, in cells, times feet per cell. */
export function feetBetween(a: [number, number], b: [number, number], grid: GridSettings): number {
  const cells = Math.round(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) / grid.size)
  return cells * grid.feet
}

const SceneArt = memo(function SceneArt({ scene }: { scene: Scene }) {
  const W = scene.widthPx
  const H = scene.heightPx
  const g = scene.grid
  return (
    <>
      <View style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: THEME_BG[scene.theme] ?? THEME_BG.stone }} />
      {scene.backgroundFileId ? <Image source={fileSource(scene.backgroundFileId)} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }} contentFit="fill" cachePolicy="disk" accessibilityIgnoresInvertColors /> : null}
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
    <Animated.View style={[{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, borderWidth: 4 / Math.max(0.05, zoom), borderColor: fire.amber, backgroundColor: 'rgba(255,179,71,0.18)' }, style]} />
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
  onStart: (id: string) => void
  onMove: (id: string, dx: number, dy: number) => void
  onEnd: (id: string, dx: number, dy: number) => void
  onTap: (id: string) => void
}

const TokenView = memo(function TokenView({ token: t, campaignId, cell, characters, mine, me, active, targeted, gm, zoom, onStart, onMove, onEnd, onTap }: TokenProps) {
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
  const canDrag = mine || gm
  const label = `${tokenName(t)}${me ? ' (you)' : ''}${hp && hp.value !== null && hp.max !== null ? `, ${hp.value} of ${hp.max} hit points` : hp?.state ? `, ${hp.state}` : ''}${t.conditions.length ? `, ${t.conditions.join(', ')}` : ''}${active ? ', their turn' : ''}${targeted ? ', targeted' : ''}`

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
        {targeted ? <View pointerEvents="none" style={{ position: 'absolute', inset: -ringW * 2.5, borderRadius: w, borderWidth: ringW, borderColor: fire.red, borderStyle: 'dashed' }} /> : null}
        {frac !== null ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: cell * 0.05, right: cell * 0.05, bottom: -cell * 0.22, height: Math.max(3, cell * 0.12), borderRadius: cell, backgroundColor: 'rgba(0,0,0,0.7)' }}>
            <Animated.View style={[{ height: '100%', borderRadius: cell, backgroundColor: hp && hp.value !== null && hp.max ? hpColor(fire, hp.value, hp.max) : hp?.state === 'bloodied' ? fire.yellow : hp?.state === 'defeated' ? fire.red : fire.green }, barStyle]} />
          </View>
        ) : null}
        {t.conditions.length ? (
          <View pointerEvents="none" style={{ position: 'absolute', right: -cell * 0.12, top: -cell * 0.12, minWidth: cell * 0.36, height: cell * 0.36, paddingHorizontal: cell * 0.06, borderRadius: cell, backgroundColor: fire.amber, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: fire.accentInk, fontFamily: 'Outfit_700Bold', fontSize: cell * 0.22 }}>{t.conditions.length > 1 ? t.conditions.length : initialOf(t.conditions[0])}</Text>
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
