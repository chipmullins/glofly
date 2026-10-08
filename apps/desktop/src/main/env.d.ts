// Build settings the main process reads (from apps/desktop/.env.local; see auth.ts).
interface ImportMetaEnv {
  /** Where the Glofly server is, e.g. http://192.168.1.50:4000. Default: http://localhost:4000 */
  readonly MAIN_VITE_SERVER_URL?: string
}
