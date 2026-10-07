import { useEffect, useState } from 'react'
import LoginScreen, { type LoginDetails } from './screens/LoginScreen'
import FireflyTakeoff from './components/FireflyTakeoff'

export default function App(): React.JSX.Element {
  const [signedInAs, setSignedInAs] = useState<string | null>(null)

  async function handleLogin(details: LoginDetails): Promise<string | null> {
    const result = await window.glofly.auth.login(details)
    if (!result.ok) return result.message
    setSignedInAs(result.user.displayName)
    return null
  }

  // TEMPORARY: the main app doesn't exist yet, so after the takeoff we sign out
  // and return to the login screen. This gets replaced by opening the main app.
  useEffect(() => {
    if (!signedInAs) return
    const timer = setTimeout(async () => {
      await window.glofly.auth.logout()
      setSignedInAs(null)
    }, 6000)
    return () => clearTimeout(timer)
  }, [signedInAs])

  return (
    <>
      <LoginScreen onLogin={handleLogin} busy={signedInAs !== null} />
      {signedInAs && <FireflyTakeoff name={signedInAs} />}
    </>
  )
}
