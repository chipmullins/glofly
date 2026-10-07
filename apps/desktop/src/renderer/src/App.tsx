import { useEffect, useState } from 'react'
import LoginScreen, { type LoginDetails } from './screens/LoginScreen'
import FireflyTakeoff from './components/FireflyTakeoff'

/** "chip" or "chip@example.com" → "Chip" (until the server sends the real display name) */
function friendlyName(identifier: string): string {
  const base = identifier.split('@')[0]
  return base.charAt(0).toUpperCase() + base.slice(1)
}

export default function App(): React.JSX.Element {
  const [loggingInAs, setLoggingInAs] = useState<string | null>(null)

  function handleLogin(details: LoginDetails): void {
    setLoggingInAs(friendlyName(details.identifier))
    // TODO (next step): send details to the server, then open the main app.
  }

  // TEMPORARY: there's no server login or main app yet, so after the
  // takeoff plays we return to the login screen. Lets you replay it.
  useEffect(() => {
    if (!loggingInAs) return
    const timer = setTimeout(() => setLoggingInAs(null), 6000)
    return () => clearTimeout(timer)
  }, [loggingInAs])

  return (
    <>
      <LoginScreen onLogin={handleLogin} busy={loggingInAs !== null} />
      {loggingInAs && <FireflyTakeoff name={loggingInAs} />}
    </>
  )
}
