import { useEffect, useState } from 'react'
import type { SignedInUser } from '../../preload/api-types'
import LoginScreen, { type LoginDetails } from './screens/LoginScreen'
import MainScreen from './screens/MainScreen'
import FireflyTakeoff from './components/FireflyTakeoff'

type Screen =
  | { name: 'starting' } // checking for a saved "Keep me signed in" session
  | { name: 'login' }
  | { name: 'takeoff'; user: SignedInUser } // firefly flying, login screen underneath
  | { name: 'app'; user: SignedInUser }

// The takeoff's welcome screen is fully visible at about 2.5s. Hold it a moment, then open the app.
const TAKEOFF_MS = 3200

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ name: 'starting' })

  // On launch, try the saved session. If it's valid, go straight into the app.
  useEffect(() => {
    let cancelled = false
    window.glofly.auth.restore().then((user) => {
      if (!cancelled) setScreen(user ? { name: 'app', user } : { name: 'login' })
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Match the window buttons to whichever screen is showing.
  const theme = screen.name === 'app' ? 'app' : 'login'
  useEffect(() => {
    window.glofly.window.setTheme(theme)
  }, [theme])

  // After the takeoff, open the app.
  useEffect(() => {
    if (screen.name !== 'takeoff') return
    const timer = setTimeout(() => setScreen({ name: 'app', user: screen.user }), TAKEOFF_MS)
    return () => clearTimeout(timer)
  }, [screen])

  async function handleLogin(details: LoginDetails): Promise<string | null> {
    const result = await window.glofly.auth.login(details)
    if (!result.ok) return result.message
    setScreen({ name: 'takeoff', user: result.user })
    return null
  }

  async function handleLogout(): Promise<void> {
    await window.glofly.auth.logout()
    setScreen({ name: 'login' })
  }

  switch (screen.name) {
    case 'starting':
      return <div className="starting" aria-busy="true" />
    case 'login':
    case 'takeoff':
      // Same tree for both, so the login screen stays put underneath the firefly.
      return (
        <>
          <LoginScreen onLogin={handleLogin} busy={screen.name === 'takeoff'} />
          {screen.name === 'takeoff' && <FireflyTakeoff name={screen.user.displayName} />}
        </>
      )
    case 'app':
      return <MainScreen user={screen.user} onLogout={handleLogout} />
  }
}
