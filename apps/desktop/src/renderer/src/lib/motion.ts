// 0.7.5 motion (Motion.dc.html): menus and dialogs close with a quick 160 ms fade-and-drop
// instead of vanishing. Screens don't need to know: when React takes a menu or a dialog out, a
// still copy of it is put back in the same spot for the length of the closing animation (it
// can't be clicked or focused, and screen readers skip it), then removed. Opening is plain CSS
// (main.css). Under Reduce Motion the copy just fades.

const LEAVING_MS = 220 // a little longer than the longest closing animation (200 ms backdrop)

/** What gets a closing animation: dropdown menus and dialogs. */
const ANIMATED = '.menu, .dialog-backdrop'

/** Opens from the corner nearest to where it sits: below the middle of the window it grows
 *  upward, on the right half it grows from the right. Set before the first frame is drawn. */
function placeOrigin(menu: HTMLElement): void {
  const r = menu.getBoundingClientRect()
  if (!r.width) return
  const up = r.top + r.height / 2 > window.innerHeight * 0.6
  const right = r.left + r.width / 2 > window.innerWidth / 2
  menu.style.setProperty('--glo-menu-origin', `${up ? 'bottom' : 'top'} ${right ? 'right' : 'left'}`)
  menu.style.setProperty('--glo-menu-dy', up ? '6px' : '-6px')
}

function leave(node: HTMLElement, parent: Node, before: Node | null): void {
  if (!parent.isConnected) return // the whole screen went away: nothing to animate
  const ghost = node.cloneNode(true) as HTMLElement
  ghost.classList.add('glo-leaving')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.setAttribute('inert', '')
  ghost.removeAttribute('id')
  for (const el of ghost.querySelectorAll('[id]')) el.removeAttribute('id')
  try {
    parent.insertBefore(ghost, before && before.parentNode === parent ? before : null)
  } catch {
    return
  }
  // Only things floating above the page (never something that would push the layout around).
  const position = getComputedStyle(ghost).position
  if (position !== 'absolute' && position !== 'fixed') {
    ghost.remove()
    return
  }
  window.setTimeout(() => ghost.remove(), LEAVING_MS)
}

// A message you send rises into place (translateY 24px, scale .96, 260 ms). It's shown at once
// as "sending" and then swapped for the saved message when the server answers; the saved one
// carries on the same rise (a negative delay) so the swap never jumps.
const RISE_MS = 260

function messageIn(node: HTMLElement): HTMLElement | null {
  if (node.matches('.message')) return node
  const inside = node.querySelectorAll<HTMLElement>('.message')
  return inside.length === 1 ? inside[0] : null
}

function rise(row: HTMLElement, startedAt: number): void {
  const elapsed = performance.now() - startedAt
  if (elapsed >= RISE_MS) return
  row.dataset.riseStart = String(startedAt)
  row.style.animationDelay = elapsed > 0 ? `${-Math.round(elapsed)}ms` : ''
  row.classList.add('msg-rise')
  window.setTimeout(() => {
    row.classList.remove('msg-rise')
    row.style.animationDelay = ''
  }, RISE_MS - elapsed + 40)
}

function messages(records: MutationRecord[]): void {
  // A "sending" row that just went away: the saved message that replaces it continues its rise.
  let carry: { parent: Node; startedAt: number } | null = null
  for (const record of records) {
    for (const node of record.removedNodes) {
      if (!(node instanceof HTMLElement)) continue
      const row = messageIn(node)
      if (row?.dataset.riseStart) carry = { parent: record.target, startedAt: Number(row.dataset.riseStart) }
    }
  }
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof HTMLElement)) continue
      const row = messageIn(node)
      if (!row || row.dataset.riseStart) continue
      if (row.dataset.pending === 'sending') rise(row, performance.now())
      else if (carry && carry.parent === record.target) {
        rise(row, carry.startedAt)
        carry = null
      }
    }
  }
}

export function startMotion(): void {
  if (typeof MutationObserver === 'undefined') return
  const observer = new MutationObserver((records) => {
    messages(records)
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.classList.contains('glo-leaving')) continue
        if (node.matches('.menu')) placeOrigin(node)
        else for (const menu of node.querySelectorAll<HTMLElement>('.menu')) placeOrigin(menu)
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.classList.contains('glo-leaving') || !node.matches(ANIMATED)) continue
        leave(node, record.target, record.nextSibling)
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
