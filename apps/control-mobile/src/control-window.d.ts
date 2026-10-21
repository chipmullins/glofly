import type { ControlApi } from '../../control/src/preload/types'

// apps/control/src/renderer/src/lib/api.ts calls `window.control.call(...)`. On the phone that
// global is made by src/lib/transport.ts (`installWindowControl`): signed requests from the approved
// iPhone. Only `call` exists here (desktop Control's other bridge functions aren't used).
declare global {
  interface Window {
    control: Pick<ControlApi, 'call'>
  }
}

export {}
