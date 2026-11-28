import type { DiscordVoicePresence } from '@glofly/shared'
import { bridgeAvatarUrl } from '../lib/media'
import './DiscordVoice.css'

// Nov 28: under a voice nebula paired with a Discord voice channel (Settings → Discord bridge):
// who's in that Discord channel right now, and a way to open it in Discord. No sound crosses; the
// people in this nebula show in Discord the same way (the bridge's message in that channel's chat).

const FACES_MAX = 4

function namesLine(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

export function DiscordVoice({ discord }: { discord: DiscordVoicePresence }): React.JSX.Element {
  const people = discord.people
  return (
    <div className="dcv" role="group" aria-label={`Discord #${discord.channelName}`}>
      <div className="dcv-head">
        <BridgeIcon />
        <span className="dcv-where">
          {people.length ? 'On Discord' : 'Paired with Discord'} · #{discord.channelName}
        </span>
      </div>
      {people.length > 0 && (
        <div className="dcv-people">
          <span className="dcv-faces" aria-hidden="true">
            {people.slice(0, FACES_MAX).map((p, i) =>
              p.avatar ? (
                <img key={i} className="dcv-face" src={bridgeAvatarUrl(p.avatar)} alt="" />
              ) : (
                <span key={i} className="dcv-face dcv-face--letter">
                  {(p.name.trim()[0] ?? '?').toUpperCase()}
                </span>
              )
            )}
          </span>
          <span className="dcv-names">{namesLine(people.map((p) => p.name))}</span>
        </div>
      )}
      <button
        type="button"
        className="dcv-open"
        title="Opens Discord. Who's here in Glofly shows there too."
        onClick={(e) => {
          e.stopPropagation()
          window.open(discord.url, '_blank', 'noopener')
        }}
      >
        Open in Discord
      </button>
    </div>
  )
}

function BridgeIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />
    </svg>
  )
}
