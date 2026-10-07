import type { GloflyApi } from './api-types'

declare global {
  interface Window {
    glofly: GloflyApi
  }
}
