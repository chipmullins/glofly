import { useMemo, useState, type ReactNode } from 'react'
import { Linking, Platform, Pressable, ScrollView, View, type TextStyle } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  codeLanguage,
  highlightCode,
  mightBeFormatted,
  parseFormatted,
  type CodeTokenKind,
  type FmtBlock,
  type FmtInline,
} from '@glofly/shared'
import { Text } from '@/ui/kit'

// A message's text with its formatting on phones (0.9.3, same rules as desktop: shared format.ts).
// `renderPlain` draws each plain piece (mentions, emoji) so mentions still work inside bold or
// quotes. Code blocks are a dark panel with editor colors in both themes; spoilers hide until tapped.

export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

export type FormattedLook = {
  size: number
  ink: string
  link: string
  quoteLine: string
  quoteInk: string
  inlineCodeBg: string
  spoilerBg: string
}

const TOKEN: Record<CodeTokenKind, string> = {
  plain: '#F5EDE6',
  kw: '#FF9E64',
  str: '#A6E3A1',
  num: '#F5C2E7',
  com: '#A8968A',
  lit: '#89DCEB',
  key: '#8CB8FF',
  fn: '#F9E2AF',
  tag: '#F38BA8',
  punc: '#D9C2B1',
}

export function Formatted({
  text,
  look,
  renderPlain,
  onLongPress,
}: {
  text: string
  look: FormattedLook
  renderPlain: (text: string, key: string) => ReactNode[]
  onLongPress?: () => void
}) {
  const blocks = useMemo(() => (mightBeFormatted(text) ? parseFormatted(text) : null), [text])
  const lineHeight = Math.round(look.size * 1.4)
  const base: TextStyle = { color: look.ink, lineHeight }
  if (!blocks)
    return (
      <Text size={look.size} style={base} selectable={false}>
        {renderPlain(text, 'p')}
      </Text>
    )
  return (
    <View style={{ gap: 4 }}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} id={`${i}`} look={look} base={base} renderPlain={renderPlain} onLongPress={onLongPress} />
      ))}
    </View>
  )
}

function Block({
  block,
  id,
  look,
  base,
  renderPlain,
  onLongPress,
}: {
  block: FmtBlock
  id: string
  look: FormattedLook
  base: TextStyle
  renderPlain: (text: string, key: string) => ReactNode[]
  onLongPress?: () => void
}) {
  if (block.t === 'codeblock') return <CodeBlock code={block.code} lang={block.lang} onLongPress={onLongPress} />
  const inner = <Inline nodes={block.c} id={id} look={look} renderPlain={renderPlain} />
  if (block.t === 'quote')
    return (
      <View style={{ borderLeftWidth: 3, borderLeftColor: look.quoteLine, paddingLeft: 10 }}>
        <Text size={look.size} style={{ ...base, color: look.quoteInk }} selectable={false}>
          {inner}
        </Text>
      </View>
    )
  return (
    <Text size={look.size} style={base} selectable={false}>
      {inner}
    </Text>
  )
}

function Inline({
  nodes,
  id,
  look,
  renderPlain,
}: {
  nodes: FmtInline[]
  id: string
  look: FormattedLook
  renderPlain: (text: string, key: string) => ReactNode[]
}) {
  return (
    <>
      {nodes.map((n, i) => {
        const key = `${id}.${i}`
        switch (n.t) {
          case 'text':
            return renderPlain(n.text, key)
          case 'code':
            return (
              <Text key={key} size={look.size - 2} style={{ fontFamily: MONO, backgroundColor: look.inlineCodeBg, color: look.ink }}>
                {` ${n.text} `}
              </Text>
            )
          case 'link':
            return (
              <Text
                key={key}
                size={look.size}
                style={{ color: look.link, textDecorationLine: 'underline' }}
                onPress={() => (n.url.startsWith('https://') ? void Linking.openURL(n.url) : undefined)}
                accessibilityRole="link"
              >
                {n.url}
              </Text>
            )
          case 'spoiler':
            return <Spoiler key={key} nodes={n.c} id={key} look={look} renderPlain={renderPlain} />
          case 'b':
            return (
              <Text key={key} size={look.size} weight="bold" style={{ color: look.ink }}>
                <Inline nodes={n.c} id={key} look={look} renderPlain={renderPlain} />
              </Text>
            )
          case 'i':
            return (
              <Text key={key} size={look.size} style={{ fontStyle: 'italic', color: look.ink }}>
                <Inline nodes={n.c} id={key} look={look} renderPlain={renderPlain} />
              </Text>
            )
          case 's':
            return (
              <Text key={key} size={look.size} style={{ textDecorationLine: 'line-through', color: look.ink }}>
                <Inline nodes={n.c} id={key} look={look} renderPlain={renderPlain} />
              </Text>
            )
        }
      })}
    </>
  )
}

/** Plain text of a spoiler (shown as covered blocks of the same length until tapped). */
function spoilerText(nodes: FmtInline[]): string {
  return nodes
    .map((n) => (n.t === 'text' || n.t === 'code' ? n.text : n.t === 'link' ? n.url : spoilerText(n.c)))
    .join('')
}

function Spoiler({
  nodes,
  id,
  look,
  renderPlain,
}: {
  nodes: FmtInline[]
  id: string
  look: FormattedLook
  renderPlain: (text: string, key: string) => ReactNode[]
}) {
  const [shown, setShown] = useState(false)
  if (shown)
    return (
      <Text size={look.size} style={{ color: look.ink, backgroundColor: look.inlineCodeBg }}>
        <Inline nodes={nodes} id={id} look={look} renderPlain={renderPlain} />
      </Text>
    )
  // Covered: the same width as the text, in the spoiler color (nothing readable is drawn).
  return (
    <Text
      size={look.size}
      style={{ color: look.spoilerBg, backgroundColor: look.spoilerBg }}
      onPress={() => setShown(true)}
      accessibilityRole="button"
      accessibilityLabel="Spoiler, tap to show it"
    >
      {spoilerText(nodes).replace(/\S/g, '█')}
    </Text>
  )
}

function CodeBlock({ code, lang, onLongPress }: { code: string; lang: string | null; onLongPress?: () => void }) {
  const kind = useMemo(() => codeLanguage(lang, code), [lang, code])
  const tokens = useMemo(() => highlightCode(code, kind), [code, kind])
  const [copied, setCopied] = useState(false)
  const label = lang ?? (kind === 'json' ? 'json' : 'code')
  return (
    <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: '#1C1210', borderWidth: 1, borderColor: '#3A2A22', marginTop: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#2A1C17', paddingLeft: 12, paddingRight: 4, minHeight: 36 }}>
        <Text size={12} style={{ fontFamily: MONO, color: '#D9C2B1' }}>
          {label}
        </Text>
        <Pressable
          onPress={() => {
            void Clipboard.setStringAsync(code).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            })
          }}
          accessibilityRole="button"
          accessibilityLabel="Copy code"
          hitSlop={6}
          style={{ minHeight: 30, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#3A2A22', justifyContent: 'center' }}
        >
          <Text size={12} weight="bold" style={{ color: '#F5EDE6' }}>
            {copied ? 'Copied' : 'Copy'}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Pressable onLongPress={onLongPress} delayLongPress={350}>
          <Text size={13} style={{ fontFamily: MONO, lineHeight: 20, color: TOKEN.plain, padding: 12 }} selectable={false}>
            {tokens.map((t, i) =>
              t.k === 'plain' ? (
                t.text
              ) : (
                <Text key={i} size={13} style={{ fontFamily: MONO, color: TOKEN[t.k], fontStyle: t.k === 'com' ? 'italic' : 'normal' }}>
                  {t.text}
                </Text>
              ),
            )}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}
