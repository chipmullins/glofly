// Build settings the main process reads (.env.production for installer builds).
interface ImportMetaEnv {
  /** Where the Glofly server is. Default (npm run dev): http://localhost:4000 */
  readonly MAIN_VITE_SERVER_URL?: string
}
