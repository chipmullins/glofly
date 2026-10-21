// Metro for a monorepo: Expo finds the workspace root (and watches it) by itself. The extra: Control
// for iPhone reuses desktop Control's typed API client and its date/number helpers straight from
// their TypeScript source (apps/control/src/renderer/src/lib), so there is one source of truth for
// the server's shapes. api.ts's own relative import (../../../preload/types) is type-only.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

const controlLib = path.resolve(__dirname, '../control/src/renderer/src/lib')
const ALIASES = {
  '@control/api': path.join(controlLib, 'api.ts'),
  '@control/format': path.join(controlLib, 'format.ts'),
}

const defaultResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (ALIASES[moduleName]) return { type: 'sourceFile', filePath: ALIASES[moduleName] }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
