import { createBridge } from './bridge'

// Communities round (Nov 2026): Sign in with Glofly. chat.glofly.app/oauth/authorize?… keeps the
// request for this tab and opens Glofly as usual; once you're signed in, the app asks
// (OAuthConsent). The address goes back to / so a reload doesn't ask twice.
if (location.pathname === '/oauth/authorize') {
  try {
    sessionStorage.setItem('glofly.oauthRequest', location.search.slice(1, 2001))
  } catch {
    // (no storage: the request is lost; the app shows nothing special)
  }
  history.replaceState(null, '', '/')
}

// Must run before any of the desktop screens' modules: some read window.glofly as they load.
window.glofly = createBridge()
