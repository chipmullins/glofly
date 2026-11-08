import { memo, useMemo, useState, type ReactNode } from 'react'
import {
  codeLanguage,
  highlightCode,
  mightBeFormatted,
  parseFormatted,
  type FmtBlock,
  type FmtInline
} from '@glofly/shared'
import './Formatted.css'

/**
 * A message's text with its formatting (0.9.3): bold, italic, strike, code, code blocks with
 * colors, quotes, spoilers and links. `renderText` draws each plain piece (mentions, emoji), so
 * mentions keep working inside bold or quotes. Inside code nothing is a mention or an emoji.
 */
function FormattedText({
  text,
  renderText
}: {
  text: string
  renderText: (text: string, key: string) => ReactNode
}): React.JSX.Element {
  const blocks = useMemo(() => (mightBeFormatted(text) ? parseFormatted(text) : null), [text])
  if (!blocks) return <>{renderText(text, 'plain')}</>
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={i} block={b} id={`${i}`} renderText={renderText} />
      ))}
    </>
  )
}

export default memo(FormattedText)

function Block({
  block,
  id,
  renderText
}: {
  block: FmtBlock
  id: string
  renderText: (text: string, key: string) => ReactNode
}): React.JSX.Element {
  if (block.t === 'codeblock') return <CodeBlock code={block.code} lang={block.lang} />
  const inner = <Inline nodes={block.c} id={id} renderText={renderText} />
  if (block.t === 'quote') return <span className="fmt-quote">{inner}</span>
  return <span className="fmt-p">{inner}</span>
}

function Inline({
  nodes,
  id,
  renderText
}: {
  nodes: FmtInline[]
  id: string
  renderText: (text: string, key: string) => ReactNode
}): React.JSX.Element {
  return (
    <>
      {nodes.map((n, i) => {
        const key = `${id}.${i}`
        switch (n.t) {
          case 'text':
            return renderText(n.text, key)
          case 'code':
            return (
              <code key={key} className="fmt-code">
                {n.text}
              </code>
            )
          case 'link':
            // Only https links open (the window sends them to the browser); the address is
            // always what's shown, so a link can't pretend to go somewhere else.
            return n.url.startsWith('https://') ? (
              <a key={key} className="fmt-link" href={n.url} target="_blank" rel="noopener noreferrer">
                {n.url}
              </a>
            ) : (
              <span key={key}>{n.url}</span>
            )
          case 'spoiler':
            return <Spoiler key={key} nodes={n.c} id={key} renderText={renderText} />
          case 'b':
            return (
              <strong key={key}>
                <Inline nodes={n.c} id={key} renderText={renderText} />
              </strong>
            )
          case 'i':
            return (
              <em key={key}>
                <Inline nodes={n.c} id={key} renderText={renderText} />
              </em>
            )
          case 's':
            return (
              <s key={key}>
                <Inline nodes={n.c} id={key} renderText={renderText} />
              </s>
            )
        }
      })}
    </>
  )
}

function Spoiler({
  nodes,
  id,
  renderText
}: {
  nodes: FmtInline[]
  id: string
  renderText: (text: string, key: string) => ReactNode
}): React.JSX.Element {
  const [shown, setShown] = useState(false)
  if (shown) {
    return (
      <span className="fmt-spoiler fmt-spoiler--shown">
        <Inline nodes={nodes} id={id} renderText={renderText} />
      </span>
    )
  }
  return (
    <button
      type="button"
      className="fmt-spoiler"
      aria-label="Spoiler, click to show it"
      title="Spoiler: click to show it"
      onClick={(e) => {
        e.stopPropagation()
        setShown(true)
      }}
    >
      <span aria-hidden="true">
        <Inline nodes={nodes} id={id} renderText={renderText} />
      </span>
    </button>
  )
}

const LANG_LABEL: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'shell',
  yml: 'yaml',
  cfg: 'cfg'
}

function CodeBlock({ code, lang }: { code: string; lang: string | null }): React.JSX.Element {
  const kind = useMemo(() => codeLanguage(lang, code), [lang, code])
  const tokens = useMemo(() => highlightCode(code, kind), [code, kind])
  const [copied, setCopied] = useState(false)
  const label = lang ? (LANG_LABEL[lang] ?? lang) : kind === 'json' ? 'json' : null
  return (
    <span className="fmt-codeblock" role="group" aria-label={label ? `${label} code` : 'Code'}>
      <span className="fmt-codeblock-bar">
        <span className="fmt-codeblock-lang">{label ?? 'code'}</span>
        <button
          type="button"
          className="fmt-codeblock-copy"
          onClick={(e) => {
            e.stopPropagation()
            void navigator.clipboard.writeText(code).then(
              () => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1600)
              },
              () => undefined
            )
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </span>
      <code className="fmt-codeblock-code">
        {tokens.map((t, i) =>
          t.k === 'plain' ? (
            t.text
          ) : (
            <span key={i} className={`tok-${t.k}`}>
              {t.text}
            </span>
          )
        )}
      </code>
    </span>
  )
}
