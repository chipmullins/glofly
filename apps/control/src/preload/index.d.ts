import type { ControlApi } from './types'

declare global {
  interface Window {
    control: ControlApi
  }
}
