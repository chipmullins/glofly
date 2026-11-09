import wordmarkImg from '../assets/glofly-wordmark.png'
import { PRIVACY_URL, SITE_URL, SUPPORT_EMAIL, TERMS_URL } from '../lib/links'

// Settings → About: version, the legal pages, how to reach us, and the credits the app's
// emoji pictures, fonts and open-source parts ask for. Links open in the default browser.

type Credit = { name: string; url: string; detail: string; license: string; licenseUrl: string }

const CREDITS: Credit[] = [
  {
    name: 'Twemoji',
    url: 'https://github.com/jdecked/twemoji',
    detail: 'Emoji graphics, copyright 2020 Twitter, Inc and other contributors',
    license: 'CC-BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/'
  },
  {
    name: 'Outfit and DM Sans',
    url: 'https://fonts.google.com/',
    detail: 'Fonts',
    license: 'SIL Open Font License 1.1',
    licenseUrl: 'https://openfontlicense.org/'
  },
  {
    name: 'Electron',
    url: 'https://www.electronjs.org/',
    detail: 'Desktop app framework, including Chromium',
    license: 'MIT',
    licenseUrl: 'https://github.com/electron/electron/blob/main/LICENSE'
  },
  {
    name: 'React',
    url: 'https://react.dev/',
    detail: 'User interface',
    license: 'MIT',
    licenseUrl: 'https://github.com/facebook/react/blob/main/LICENSE'
  },
  {
    name: 'LiveKit',
    url: 'https://livekit.io/',
    detail: 'Voice, video and screen sharing',
    license: 'Apache 2.0',
    licenseUrl: 'https://github.com/livekit/client-sdk-js/blob/main/LICENSE'
  },
  {
    name: 'Socket.IO',
    url: 'https://socket.io/',
    detail: 'Real-time messages',
    license: 'MIT',
    licenseUrl: 'https://github.com/socketio/socket.io/blob/main/LICENSE'
  },
  {
    name: 'U²-Net',
    url: 'https://github.com/xuebinqin/U-2-Net',
    detail: 'Cutting out stickers from photos',
    license: 'Apache 2.0',
    licenseUrl: 'https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE'
  },
  {
    name: 'Emojibase',
    url: 'https://emojibase.dev/',
    detail: 'Emoji names and search words',
    license: 'MIT',
    licenseUrl: 'https://github.com/milesj/emojibase/blob/master/LICENSE'
  }
]

function ExternalIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

export default function AboutSettings({ version }: { version: string | null }): React.JSX.Element {
  return (
    <>
      <div className="about-hero">
        <img src={wordmarkImg} alt="Glofly" className="about-wordmark" draggable={false} />
        <span className="about-version">Version {version ?? '…'}</span>
        <span className="settings-row-desc">A brighter kind of together.</span>
      </div>

      <section className="settings-section">
        <h2>Help and legal</h2>
        <div className="settings-card about-links">
          <a className="about-link" href={TERMS_URL} target="_blank" rel="noreferrer">
            <span className="settings-row-label">Terms of Service</span>
            <ExternalIcon />
          </a>
          <a className="about-link" href={PRIVACY_URL} target="_blank" rel="noreferrer">
            <span className="settings-row-label">Privacy Policy</span>
            <ExternalIcon />
          </a>
          <a
            className="about-link"
            href={`mailto:${SUPPORT_EMAIL}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="settings-row-text">
              <span className="settings-row-label">Contact support</span>
              <span className="settings-row-desc">
                {SUPPORT_EMAIL}: questions, problems, or reporting someone
              </span>
            </span>
            <ExternalIcon />
          </a>
          <a className="about-link" href={SITE_URL} target="_blank" rel="noreferrer">
            <span className="settings-row-label">glofly.app</span>
            <ExternalIcon />
          </a>
        </div>
      </section>

      <section className="settings-section">
        <h2>Credits</h2>
        <ul className="settings-card about-credits">
          {CREDITS.map((c) => (
            <li key={c.name} className="about-credit">
              <span className="settings-row-text">
                <a className="about-credit-name" href={c.url} target="_blank" rel="noreferrer">
                  {c.name}
                </a>
                <span className="settings-row-desc">{c.detail}</span>
              </span>
              <a className="about-license" href={c.licenseUrl} target="_blank" rel="noreferrer">
                {c.license}
              </a>
            </li>
          ))}
        </ul>
        <p className="about-footnote">
          GIFs: Powered by GIPHY. Game info by IGDB. Steam, Twitch, Kick and YouTube accounts and
          alerts come from those services; Glofly isn&rsquo;t endorsed by them. YouTube Live alerts
          use YouTube API Services:{' '}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            YouTube Terms of Service
          </a>
          ,{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          .
        </p>
        <p className="about-footnote">
          Glofly’s sounds and firefly artwork were made for Glofly. © 2026 Glofly · Created by Chip
          Mullins.
        </p>
      </section>
    </>
  )
}
