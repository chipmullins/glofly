import { useEffect, useState } from 'react'
import type { RegisterRequest, SignedInUser } from '../../preload/api-types'
import LoginScreen, { type LoginDetails } from './screens/LoginScreen'
import RegisterScreen from './screens/RegisterScreen'
import MainScreen from './screens/MainScreen'
import FireflyTakeoff from './components/FireflyTakeoff'

type AuthScreen = 'login' | 'register'

type Screen =
  | { name: 'starting' } // checking for a saved "Keep me signed in" session
  | { name: 'auth'; form: AuthScreen }
  | { name: 'takeoff'; form: AuthScreen; user: SignedInUser; isNew: boolean } // firefly flying over the form
  | { name: 'app'; user: SignedInUser }

// The takeoff's welcome screen is fully visible at about 2.5s. Hold it a moment, then open the app.
const TAKEOFF_MS = 3200

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ name: 'starting' })

  // On launch, try the saved session. If it's valid, go straight into the app.
  useEffect(() => {
    let cancelled = false
    window.glofly.auth.restore().then((user) => {
      if (!cancelled) setScreen(user ? { name: 'app', user } : { name: 'auth', form: 'login' })
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
    setScreen({ name: 'takeoff', form: 'login', user: result.user, isNew: false })
    return null
  }

  async function handleRegister(
    request: RegisterRequest
  ): Promise<{ fields: Record<string, string>; message?: string } | null> {
    const result = await window.glofly.auth.register(request)
    if (!result.ok) return { fields: result.fields, message: result.message }
    setScreen({ name: 'takeoff', form: 'register', user: result.user, isNew: true })
    return null
  }

  async function handleLogout(): Promise<void> {
    await window.glofly.auth.logout()
    setScreen({ name: 'auth', form: 'login' })
  }

  const showForm = (form: AuthScreen) => () => setScreen({ name: 'auth', form })

  switch (screen.name) {
    case 'starting':
      return <div className="starting" aria-busy="true" />
    case 'auth':
    case 'takeoff': {
      // Same tree either way, so the form stays put underneath the firefly.
      const flying = screen.name === 'takeoff'
      return (
        <>
          {screen.form === 'login' ? (
            <LoginScreen
              onLogin={handleLogin}
              onCreateAccount={showForm('register')}
              busy={flying}
            />
          ) : (
            <RegisterScreen onRegister={handleRegister} onLogin={showForm('login')} busy={flying} />
          )}
          {flying && (
            <FireflyTakeoff
              title={
                screen.isNew
                  ? `Welcome to Glofly, ${screen.user.displayName}`
                  : `Welcome back, ${screen.user.displayName}`
              }
              status={screen.isNew ? 'Getting things ready' : 'Loading your chats'}
            />
          )}
        </>
      )
    }
    case 'app':
      return <MainScreen user={screen.user} onLogout={handleLogout} />
  }
}
