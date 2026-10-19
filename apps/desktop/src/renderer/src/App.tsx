import { useCallback, useEffect, useState } from 'react'
import type { Paused, RegisterRequest, SignedInUser, UpdateRequired } from '../../preload/api-types'
import LoginScreen, { type LoginDetails, type LoginProblem } from './screens/LoginScreen'
import RegisterScreen, { type RegisterPhoto } from './screens/RegisterScreen'
import MainScreen from './screens/MainScreen'
import FireflyTakeoff from './components/FireflyTakeoff'
import UpdateRequiredScreen from './components/UpdateRequired'
import PausedScreen from './components/Paused'
import { playSound } from './lib/sounds'

type AuthScreen = 'login' | 'register'

type Screen =
  | { name: 'starting' } // checking for a saved "Keep me signed in" session
  | { name: 'auth'; form: AuthScreen; notice?: string }
  | { name: 'takeoff'; form: AuthScreen; user: SignedInUser; isNew: boolean } // firefly flying over the form
  | { name: 'app'; user: SignedInUser }

// The takeoff's welcome screen is fully visible at about 2.5s. Hold it a moment, then open the app.
const TAKEOFF_MS = 3200

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ name: 'starting' })
  // The server needs a newer Glofly (Control → minimum app version): covers everything.
  const [updateRequired, setUpdateRequired] = useState<UpdateRequired | null>(null)
  // Glofly is paused (Glofly Control → Server): covers everything until it's back.
  const [paused, setPaused] = useState<Paused | null>(null)
  useEffect(() => {
    void window.glofly.appStatus.updateRequired().then((info) => info && setUpdateRequired(info))
    void window.glofly.appStatus.paused().then((info) => info && setPaused(info))
    return window.glofly.onEvent((event) => {
      if (event.type === 'app:update-required') {
        setUpdateRequired({
          message: event.message,
          minVersion: event.minVersion,
          downloadUrl: event.downloadUrl
        })
      }
      if (event.type === 'app:paused') setPaused({ message: event.message, since: event.since })
      // Back: start fresh (signs back in with the saved session and reconnects).
      if (event.type === 'app:resumed') window.location.reload()
    })
  }, [])

  // On launch, try the saved session. If it's valid, go straight into the app.
  useEffect(() => {
    let cancelled = false
    window.glofly.auth
      .restore()
      .catch(() => null) // (never stuck on the blank starting screen)
      .then((user) => {
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
    const timer = setTimeout(() => {
      playSound('login')
      setScreen({ name: 'app', user: screen.user })
    }, TAKEOFF_MS)
    return () => clearTimeout(timer)
  }, [screen])

  async function handleLogin(details: LoginDetails): Promise<LoginProblem | null> {
    const result = await window.glofly.auth.login(details)
    if (!result.ok) {
      if (result.reason === 'two_step') return { twoStep: result.twoStep }
      return result.reason === 'deletion_scheduled' && 'deleteAfter' in result && result.deleteAfter
        ? { deleteAfter: result.deleteAfter }
        : { message: result.message }
    }
    setScreen({ name: 'takeoff', form: 'login', user: result.user, isNew: false })
    return null
  }

  // 0.7.3: signed in with a two-step code or a QR code.
  const handleSignedIn = useCallback(
    (user: SignedInUser) => setScreen({ name: 'takeoff', form: 'login', user, isNew: false }),
    []
  )

  async function handleRegister(
    request: RegisterRequest,
    photo: RegisterPhoto | null
  ): Promise<{ fields: Record<string, string>; message?: string } | null> {
    const result = await window.glofly.auth.register(request)
    if (!result.ok) return { fields: result.fields, message: result.message }
    setScreen({ name: 'takeoff', form: 'register', user: result.user, isNew: true })
    // The photo picked on the Register screen goes up while the firefly flies. If it doesn't
    // make it, the account is fine: they can add a photo later in Edit profile.
    if (photo) {
      void window.glofly.profile.setPhoto(photo.data, photo.type).then((uploaded) => {
        if (!uploaded.ok) return
        const { avatarVersion } = uploaded.data
        setScreen((s) =>
          (s.name === 'takeoff' || s.name === 'app') && s.user.id === result.user.id
            ? { ...s, user: { ...s.user, avatarVersion } }
            : s
        )
      })
    }
    return null
  }

  async function handleLogout(): Promise<void> {
    playSound('logout')
    try {
      await window.glofly.auth.logout()
    } finally {
      setScreen({ name: 'auth', form: 'login' })
    }
  }

  // The server ended the session (it expired, or was signed out elsewhere).
  const handleSessionExpired = useCallback(() => setScreen({ name: 'auth', form: 'login' }), [])

  // Deleted from Settings → Account: this device is already signed out.
  const handleAccountDeleted = useCallback((deleteAfter: string) => {
    const date = new Date(deleteAfter).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    })
    setScreen({
      name: 'auth',
      form: 'login',
      notice: `Your account will be deleted on ${date}. Log in before then if you change your mind.`
    })
  }, [])

  // Your name or photo changed: update it everywhere.
  const handleUserChange = useCallback(
    (changes: Pick<SignedInUser, 'displayName' | 'avatarVersion'>) =>
      setScreen((s) => (s.name === 'app' ? { ...s, user: { ...s.user, ...changes } } : s)),
    []
  )

  const showForm = (form: AuthScreen) => () => setScreen({ name: 'auth', form })

  if (updateRequired) return <UpdateRequiredScreen info={updateRequired} />
  if (paused) return <PausedScreen info={paused} />

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
              onSignedIn={handleSignedIn}
              busy={flying}
              notice={screen.name === 'auth' ? screen.notice : null}
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
      return (
        <MainScreen
          user={screen.user}
          onLogout={handleLogout}
          onSessionExpired={handleSessionExpired}
          onAccountDeleted={handleAccountDeleted}
          onUserChange={handleUserChange}
        />
      )
  }
}
