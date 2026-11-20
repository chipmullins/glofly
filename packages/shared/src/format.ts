// Text formatting in messages (0.9.3, approved canvas "Glofly: forwarding, formatting, live
// alerts, Steam", board 3).
//
// Messages stay plain text with markers, so older apps (and anything that copies the text) still
// read fine:
//   **bold**  *italic* or _italic_  ~~strike~~  `code`  ||spoiler||
//   ```lang            > a quoted line
//   code block
//   ```
// Links are never hidden behind other words: a bare https:// address becomes a link that shows
// its own address. Everything here is pure so the server (previews, pushes), the desktop and
// browser apps and the phones agree on it.

export type FmtInline =
  | { t: 'text'; text: string }
  | { t: 'b' | 'i' | 's' | 'spoiler'; c: FmtInline[] }
  | { t: 'code'; text: string }
  | { t: 'link'; url: string }

export type FmtBlock =
  | { t: 'p'; c: FmtInline[] }
  | { t: 'quote'; c: FmtInline[] }
  | { t: 'codeblock'; lang: string | null; code: string }

/** The languages code blocks color, by the name typed after ``` (lower case). */
export const CODE_LANGUAGES: Record<string, CodeLang> = {
  lua: 'lua',
  js: 'js',
  javascript: 'js',
  jsx: 'js',
  ts: 'js',
  typescript: 'js',
  tsx: 'js',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  java: 'java',
  kotlin: 'java',
  kt: 'java',
  cs: 'java',
  csharp: 'java',
  c: 'java',
  cpp: 'java',
  'c++': 'java',
  go: 'java',
  rust: 'java',
  rs: 'java',
  cfg: 'ini',
  ini: 'ini',
  toml: 'ini',
  conf: 'ini',
  properties: 'ini',
  sh: 'sh',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  ps1: 'sh',
  powershell: 'sh',
  bat: 'sh',
  cmd: 'sh',
  py: 'py',
  python: 'py',
  sql: 'sql',
  css: 'css',
  scss: 'css',
  html: 'html',
  xml: 'html',
  svg: 'html'
}
export type CodeLang = 'lua' | 'js' | 'json' | 'yaml' | 'java' | 'ini' | 'sh' | 'py' | 'sql' | 'css' | 'html'

const MAX_PARSE = 8000

/** Any formatting markers or links at all? (A cheap check so plain messages skip the parser.) */
export function mightBeFormatted(body: string): boolean {
  return /[*_~`|>]|https?:\/\//.test(body)
}

// ---------------------------------------------------------------------------------------
// Blocks

const FENCE = /^```([A-Za-z0-9+#._-]{0,20})\s*$/

/** Splits a message into paragraphs, quotes and code blocks. */
export function parseFormatted(body: string): FmtBlock[] {
  const text = body.length > MAX_PARSE ? body.slice(0, MAX_PARSE) : body
  const lines = text.split('\n')
  const blocks: FmtBlock[] = []
  let para: string[] = []
  let quote: string[] = []
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n')) })
    para = []
  }
  const flushQuote = () => {
    if (quote.length) blocks.push({ t: 'quote', c: parseInline(quote.join('\n')) })
    quote = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // A code block written on one line: ```some code```
    const one = /^```([^`\n]+)```\s*$/.exec(line)
    if (one) {
      flushPara()
      flushQuote()
      blocks.push({ t: 'codeblock', lang: null, code: one[1] })
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      // Find the closing fence; with none, the rest of the message is the block (like Discord).
      let end = i + 1
      while (end < lines.length && !/^```\s*$/.test(lines[end])) end++
      flushPara()
      flushQuote()
      const lang = fence[1].toLowerCase() || null
      blocks.push({ t: 'codeblock', lang, code: lines.slice(i + 1, end).join('\n') })
      i = end
      continue
    }
    const q = /^> ?(.*)$/.exec(line)
    if (q && (line.startsWith('> ') || line === '>')) {
      flushPara()
      quote.push(q[1])
      continue
    }
    flushQuote()
    para.push(line)
  }
  flushPara()
  flushQuote()
  // A message that's only blank lines still gets one (empty) paragraph.
  return blocks.length ? blocks : [{ t: 'p', c: [] }]
}

// ---------------------------------------------------------------------------------------
// Inline

type Marker = { open: string; close: string; t: 'b' | 'i' | 's' | 'spoiler' }
const MARKERS: Marker[] = [
  { open: '||', close: '||', t: 'spoiler' },
  { open: '**', close: '**', t: 'b' },
  { open: '~~', close: '~~', t: 's' },
  { open: '*', close: '*', t: 'i' },
  { open: '_', close: '_', t: 'i' }
]

const URL_AT = /^https?:\/\/[^\s<>"'`]+/
const isWordChar = (ch: string) => !!ch && /[\p{L}\p{N}]/u.test(ch)

/** Trailing punctuation that usually ends a sentence, not the address. */
function trimUrl(url: string): string {
  let out = url
  for (;;) {
    const last = out.charAt(out.length - 1)
    if (/[.,!?;:]/.test(last)) out = out.slice(0, -1)
    else if (last === ')' && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0))
      out = out.slice(0, -1)
    else break
  }
  return out
}

/** Inline formatting inside one paragraph or quote (nesting works: **bold *and italic***). */
export function parseInline(text: string, depth = 0): FmtInline[] {
  const out: FmtInline[] = []
  let plain = ''
  const pushPlain = () => {
    if (plain) out.push({ t: 'text', text: plain })
    plain = ''
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    // \* \_ \~ \` \| \\ show the character itself.
    if (ch === '\\' && i + 1 < text.length && /[*_~`|\\>]/.test(text[i + 1])) {
      plain += text[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      // `code` (or ``code with a ` inside``): nothing inside is formatted.
      const ticks = text.startsWith('``', i) ? '``' : '`'
      const end = text.indexOf(ticks, i + ticks.length)
      if (end !== -1 && !text.slice(i + ticks.length, end).includes('\n')) {
        const inner = text.slice(i + ticks.length, end)
        if (inner.trim()) {
          pushPlain()
          out.push({ t: 'code', text: ticks === '``' ? inner.trim() : inner })
          i = end + ticks.length
          continue
        }
      }
    }
    if ((ch === 'h' || ch === 'H') && (i === 0 || !isWordChar(text[i - 1]))) {
      const m = URL_AT.exec(text.slice(i))
      if (m) {
        const url = trimUrl(m[0])
        if (url.length > 'https://'.length) {
          pushPlain()
          out.push({ t: 'link', url })
          i += url.length
          continue
        }
      }
    }
    if (depth < 4) {
      let matched = false
      for (const mk of MARKERS) {
        if (!text.startsWith(mk.open, i)) continue
        // "**" isn't two italics, "||" isn't anything else.
        if (mk.open === '*' && text[i + 1] === '*') continue
        if (mk.open === '_' && text[i + 1] === '_') continue
        // _italic_ only between words (snake_case_names and @maya_p stay as they are).
        if (mk.open === '_' && isWordChar(text[i - 1] ?? '')) continue
        const start = i + mk.open.length
        if (start >= text.length || /\s/.test(text[start])) continue
        const close = findClose(text, start, mk)
        if (close === -1) continue
        const inner = text.slice(start, close)
        if (!inner.trim()) continue
        pushPlain()
        out.push({ t: mk.t, c: parseInline(inner, depth + 1) })
        i = close + mk.close.length
        matched = true
        break
      }
      if (matched) continue
    }
    plain += ch
    i++
  }
  pushPlain()
  return out
}

function findClose(text: string, from: number, mk: Marker): number {
  let j = from
  while (j < text.length) {
    if (text[j] === '\\') {
      j += 2
      continue
    }
    if (text[j] === '`') {
      // Skip over inline code so a marker inside it doesn't close.
      const end = text.indexOf('`', j + 1)
      if (end !== -1) {
        j = end + 1
        continue
      }
    }
    if (text.startsWith(mk.close, j) && !/\s/.test(text[j - 1] ?? '')) {
      // "***" closing a bold: the last two close the bold, the first one an italic inside it.
      if (mk.close === '**' && text[j + 2] === '*') return j + 1
      if (mk.close === '*' && text[j + 1] === '*' && text[j + 2] !== '*') {
        // "**" ahead is bold, not the end of an italic; keep looking past it.
        const bold = text.indexOf('**', j + 2)
        if (bold !== -1) {
          j = bold + 2
          continue
        }
      }
      if (mk.close === '_' && isWordChar(text[j + 1] ?? '')) {
        j++
        continue
      }
      return j
    }
    j++
  }
  return -1
}

// ---------------------------------------------------------------------------------------
// Plain text (previews, notifications, pushes, search snippets)

function inlinePlain(nodes: FmtInline[]): string {
  return nodes
    .map((n) => {
      if (n.t === 'text') return n.text
      if (n.t === 'code') return n.text
      if (n.t === 'link') return n.url
      if (n.t === 'spoiler') return 'Spoiler'
      return inlinePlain(n.c)
    })
    .join('')
}

/**
 * The message without its markers, for one-line previews (sidebar, notifications, pushes).
 * Spoilers never show there: they read "Spoiler". A code block becomes its first line.
 */
export function plainFormatted(body: string): string {
  if (!mightBeFormatted(body)) return body
  return parseFormatted(body)
    .map((b) => {
      if (b.t === 'codeblock') return b.code.split('\n').find((l) => l.trim())?.trim() ?? ''
      return inlinePlain(b.c)
    })
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------------------
// Composer helpers (desktop, browser and phones share them)

export type FormatAction = 'b' | 'i' | 's' | 'code' | 'spoiler' | 'quote' | 'codeblock'

const WRAP: Record<Exclude<FormatAction, 'quote' | 'codeblock'>, string> = {
  b: '**',
  i: '*',
  s: '~~',
  code: '`',
  spoiler: '||'
}

/**
 * Applies a toolbar button to the text and selection: wraps the selected text in markers (or takes
 * them off again when it already is), quotes the selected lines, or puts them in a code block.
 * Returns the new text and the new selection.
 */
export function applyFormat(
  text: string,
  start: number,
  end: number,
  action: FormatAction
): { text: string; start: number; end: number } {
  const a = Math.max(0, Math.min(start, end, text.length))
  const b = Math.max(a, Math.min(Math.max(start, end), text.length))
  const sel = text.slice(a, b)
  if (action === 'quote') {
    const lineStart = text.lastIndexOf('\n', a - 1) + 1
    const nl = text.indexOf('\n', b)
    const lineEnd = nl === -1 ? text.length : nl
    const lines = text.slice(lineStart, lineEnd).split('\n')
    const allQuoted = lines.every((l) => l.startsWith('> '))
    const next = lines.map((l) => (allQuoted ? l.slice(2) : `> ${l}`)).join('\n')
    return {
      text: text.slice(0, lineStart) + next + text.slice(lineEnd),
      start: lineStart,
      end: lineStart + next.length
    }
  }
  if (action === 'codeblock') {
    const before = a > 0 && text[a - 1] !== '\n' ? '\n' : ''
    const after = b < text.length && text[b] !== '\n' ? '\n' : ''
    const block = `${before}\`\`\`\n${sel}\n\`\`\`${after}`
    const caret = a + before.length + 4
    return {
      text: text.slice(0, a) + block + text.slice(b),
      start: caret,
      end: caret + sel.length
    }
  }
  const mark = WRAP[action]
  // Already wrapped (markers just outside the selection, or inside it): unwrap.
  if (text.slice(a - mark.length, a) === mark && text.slice(b, b + mark.length) === mark) {
    return {
      text: text.slice(0, a - mark.length) + sel + text.slice(b + mark.length),
      start: a - mark.length,
      end: b - mark.length
    }
  }
  if (sel.length > mark.length * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(mark.length, -mark.length)
    return { text: text.slice(0, a) + inner + text.slice(b), start: a, end: a + inner.length }
  }
  return {
    text: text.slice(0, a) + mark + sel + mark + text.slice(b),
    start: a + mark.length,
    end: b + mark.length
  }
}

// ---------------------------------------------------------------------------------------
// Code colors ("like a code editor"; Nov 8)

export type CodeTokenKind = 'plain' | 'kw' | 'str' | 'num' | 'com' | 'lit' | 'key' | 'fn' | 'tag' | 'punc'
export type CodeToken = { k: CodeTokenKind; text: string }

const KW: Record<CodeLang, string[]> = {
  lua: 'and break do else elseif end for function goto if in local not or repeat return then until while'.split(' '),
  js: 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof interface let new of return static super switch this throw try type typeof var void while with yield enum implements private protected public readonly as'.split(' '),
  json: [],
  yaml: [],
  java: 'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static super switch synchronized this throw throws try void volatile while fun val var when object namespace using struct fn let mut impl pub use mod match func go chan select defer typedef include define auto int long short char float double bool boolean string String byte unsigned signed sizeof'.split(' '),
  ini: [],
  sh: 'if then else elif fi for while do done case esac in function return export local set echo cd exit source sudo ensure start stop restart'.split(' '),
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '),
  sql: 'select from where insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset and or not null as distinct union all primary key foreign references default'.split(' '),
  css: [],
  html: []
}
const LIT: Record<CodeLang, string[]> = {
  lua: ['nil', 'true', 'false'],
  js: ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'],
  json: ['true', 'false', 'null'],
  yaml: ['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~'],
  java: ['true', 'false', 'null', 'nil', 'None', 'nullptr'],
  ini: ['true', 'false', 'yes', 'no', 'on', 'off'],
  sh: ['true', 'false'],
  py: ['True', 'False', 'None'],
  sql: ['true', 'false', 'null'],
  css: [],
  html: []
}

const MAX_HIGHLIGHT = 20000

/** Which language a code block is in: the one typed after ```, or a guess for JSON. */
export function codeLanguage(lang: string | null, code: string): CodeLang | null {
  if (lang) return CODE_LANGUAGES[lang.toLowerCase()] ?? null
  const t = code.trim()
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      JSON.parse(t)
      return 'json'
    } catch {
      return null
    }
  }
  return null
}

/** Splits code into colored pieces. Joining every piece's text gives the code back exactly. */
export function highlightCode(code: string, lang: CodeLang | null): CodeToken[] {
  if (!lang || code.length > MAX_HIGHLIGHT) return [{ k: 'plain', text: code }]
  if (lang === 'html') return highlightHtml(code)
  const out: CodeToken[] = []
  const push = (k: CodeTokenKind, text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.k === k) last.text += text
    else out.push({ k, text })
  }
  const kw = new Set(lang === 'sql' ? KW.sql : KW[lang])
  const lit = new Set(LIT[lang])
  const lineComment =
    lang === 'lua' || lang === 'sql' ? '--' : lang === 'sh' || lang === 'py' || lang === 'yaml' ? '#' : lang === 'ini' ? null : '//'
  const blockComment: [string, string] | null =
    lang === 'lua' ? ['--[[', ']]'] : lang === 'js' || lang === 'java' || lang === 'css' || lang === 'sql' ? ['/*', '*/'] : null
  let i = 0
  let lineStart = true
  while (i < code.length) {
    const ch = code[i]
    const rest = code.slice(i, i + 4)
    if (ch === '\n') {
      push('plain', ch)
      i++
      lineStart = true
      continue
    }
    if (lineStart) {
      // ini / cfg: ; or # comments, [section] headers and key = value.
      if (lang === 'ini') {
        const lineEnd = code.indexOf('\n', i) === -1 ? code.length : code.indexOf('\n', i)
        const line = code.slice(i, lineEnd)
        const lead = /^\s*/.exec(line)![0]
        const body = line.slice(lead.length)
        push('plain', lead)
        if (body.startsWith(';') || body.startsWith('#') || body.startsWith('//')) push('com', body)
        else if (/^\[[^\]]*\]\s*$/.test(body)) push('tag', body)
        else {
          const kv = /^([\w.\-]+)(\s*[=:\s]\s*)(.*)$/.exec(body)
          if (kv) {
            push(KW.sh.includes(kv[1]) || /^(set|setr|sets|ensure|start|exec|add_ace|add_principal|sv_\w+)$/.test(kv[1]) ? 'kw' : 'key', kv[1])
            push('punc', kv[2])
            pushValue(kv[3], push, lit)
          } else push('plain', body)
        }
        i = lineEnd
        lineStart = false
        continue
      }
      // YAML: "key:" at the start of a line (after indentation and "- ").
      if (lang === 'yaml') {
        const m = /^(\s*(?:-\s+)?)([\w"'.\-/ ]+?)(\s*:)(?=\s|$)/.exec(code.slice(i, code.indexOf('\n', i) === -1 ? undefined : code.indexOf('\n', i)))
        if (m && !m[2].trim().startsWith('#')) {
          push('plain', m[1])
          push('key', m[2])
          push('punc', m[3])
          i += m[0].length
          lineStart = false
          continue
        }
      }
      lineStart = false
    }
    if (blockComment && code.startsWith(blockComment[0], i)) {
      const end = code.indexOf(blockComment[1], i + blockComment[0].length)
      const stop = end === -1 ? code.length : end + blockComment[1].length
      push('com', code.slice(i, stop))
      i = stop
      continue
    }
    if (lineComment && code.startsWith(lineComment, i) && !(lang === 'sh' && i > 0 && /[\w$]/.test(code[i - 1]))) {
      const end = code.indexOf('\n', i)
      const stop = end === -1 ? code.length : end
      push('com', code.slice(i, stop))
      i = stop
      continue
    }
    if (lang === 'lua' && rest.startsWith('[[')) {
      const end = code.indexOf(']]', i + 2)
      const stop = end === -1 ? code.length : end + 2
      push('str', code.slice(i, stop))
      i = stop
      continue
    }
    if (ch === '"' || ch === "'" || (ch === '`' && lang === 'js')) {
      let j = i + 1
      while (j < code.length && code[j] !== ch) {
        if (code[j] === '\\') j++
        else if (code[j] === '\n' && ch !== '`') break
        j++
      }
      const stop = Math.min(code.length, j + 1)
      const str = code.slice(i, stop)
      // JSON keys: a string followed by ":".
      if (lang === 'json' && /^\s*:/.test(code.slice(stop))) push('key', str)
      else push('str', str)
      i = stop
      continue
    }
    if (/[0-9]/.test(ch) && !/[\w$]/.test(code[i - 1] ?? '')) {
      const m = /^(0x[0-9a-fA-F]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)/.exec(code.slice(i))!
      push('num', m[0])
      i += m[0].length
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(code.slice(i))!
      const word = m[0]
      const lower = lang === 'sql' ? word.toLowerCase() : word
      if (lit.has(word) || (lang === 'sql' && lit.has(lower))) push('lit', word)
      else if (kw.has(lower)) push('kw', word)
      else if (code[i + word.length] === '(') push('fn', word)
      else if (lang === 'css' && code.slice(i + word.length).match(/^\s*:/) && !/^\s*:\s*[a-z-]+\s*\{/.test(code.slice(i + word.length))) push('key', word)
      else push('plain', word)
      i += word.length
      continue
    }
    if (lang === 'sh' && ch === '$') {
      const m = /^\$(\{[^}]*\}|[\w@#?*!-]+)/.exec(code.slice(i))
      if (m) {
        push('key', m[0])
        i += m[0].length
        continue
      }
    }
    push(/[{}()[\];,.=<>+\-*/%!&|^~?:]/.test(ch) ? 'punc' : 'plain', ch)
    i++
  }
  return out
}

function pushValue(v: string, push: (k: CodeTokenKind, t: string) => void, lit: Set<string>) {
  const t = v.trim()
  if (!t) return push('plain', v)
  if (/^".*"$|^'.*'$/.test(t)) return push('str', v)
  if (/^-?\d+(\.\d+)?$/.test(t)) return push('num', v)
  if (lit.has(t.toLowerCase())) return push('lit', v)
  // FiveM-style: set name "value"  /  ensure resource
  const m = /^(\S+)(\s+)(.*)$/.exec(v)
  if (m && /^".*"$/.test(m[3].trim())) {
    push('plain', m[1] + m[2])
    return push('str', m[3])
  }
  push('plain', v)
}

function highlightHtml(code: string): CodeToken[] {
  const out: CodeToken[] = []
  const re = /<!--[\s\S]*?-->|<\/?[A-Za-z][\w:-]*|\/?>|"[^"]*"|'[^']*'|[\w:-]+(?==)/g
  let last = 0
  let inTag = false
  for (const m of code.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push({ k: 'plain', text: code.slice(last, at) })
    const t = m[0]
    if (t.startsWith('<!--')) out.push({ k: 'com', text: t })
    else if (t.startsWith('<')) {
      out.push({ k: 'tag', text: t })
      inTag = true
    } else if (t.endsWith('>')) {
      out.push({ k: 'tag', text: t })
      inTag = false
    } else if (inTag && (t.startsWith('"') || t.startsWith("'"))) out.push({ k: 'str', text: t })
    else if (inTag) out.push({ k: 'key', text: t })
    else out.push({ k: 'plain', text: t })
    last = at + t.length
  }
  if (last < code.length) out.push({ k: 'plain', text: code.slice(last) })
  return out
}
