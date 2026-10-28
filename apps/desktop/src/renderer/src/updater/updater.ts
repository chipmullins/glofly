import './updater.css'
import type { LaunchUpdateView } from '../../../preload/launch-update'

// 0.8.6: the launch updater window's page. It has no access to anything: the main process
// (src/main/launchUpdate.ts) calls window.gfUpdate(view) with what to show.

const MB = 1024 * 1024
const mb = (bytes: number): string => (bytes / MB).toFixed(1)

const card = document.getElementById('card') as HTMLElement
const title = document.getElementById('title') as HTMLElement
const detail = document.getElementById('detail') as HTMLElement
const bar = document.getElementById('bar') as HTMLElement
const fill = document.getElementById('fill') as HTMLElement
const foot = document.getElementById('foot') as HTMLElement

function setBar(percent: number): void {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  fill.style.width = `${p}%`
  bar.setAttribute('aria-valuenow', String(p))
}

function show(view: LaunchUpdateView): void {
  card.dataset.phase = view.phase
  switch (view.phase) {
    case 'checking':
      title.textContent = 'Checking for updates'
      detail.textContent = ''
      foot.textContent = 'Usually about a second.'
      break
    case 'downloading':
      title.textContent = 'Updating Glofly'
      detail.textContent =
        view.total > 0
          ? `Glofly ${view.version} · ${mb(view.transferred)} of ${mb(view.total)} MB`
          : `Glofly ${view.version}`
      setBar(view.percent)
      foot.textContent = 'Glofly opens by itself when it’s done.'
      break
    case 'installing':
      title.textContent = 'Updating Glofly'
      detail.textContent = `Glofly ${view.version} · Getting it ready…`
      setBar(100)
      foot.textContent = 'Glofly opens by itself when it’s done.'
      break
    case 'done':
      title.textContent = 'All set!'
      detail.textContent = `Updated to Glofly ${view.version}`
      setBar(100)
      foot.textContent = 'Opening Glofly…'
      break
    case 'offline':
      title.textContent = 'Couldn’t check for updates'
      detail.textContent = 'Opening Glofly anyway. It will check again in the background.'
      foot.textContent = ''
      break
  }
  document.title =
    view.phase === 'checking' ? 'Glofly · Checking for updates' : `Glofly · ${title.textContent}`
}

declare global {
  interface Window {
    gfUpdate: (view: LaunchUpdateView) => void
  }
}

window.gfUpdate = show
