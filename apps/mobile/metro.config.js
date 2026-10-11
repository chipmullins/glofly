// Metro for a monorepo: Expo finds the workspace root by itself; the only extra is reading
// @glofly/shared straight from its TypeScript source (the server uses its built dist/).
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
// Glofly's sounds are Ogg Opus files (the same as the desktop app's).
if (!config.resolver.assetExts.includes('ogg')) config.resolver.assetExts.push('ogg')

const sharedSrc = path.resolve(__dirname, '../../packages/shared/src')

const defaultResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@glofly/shared') {
    return { type: 'sourceFile', filePath: path.join(sharedSrc, 'index.ts') }
  }
  if (moduleName.startsWith('@glofly/shared/')) {
    return { type: 'sourceFile', filePath: path.join(sharedSrc, moduleName.slice('@glofly/shared/'.length) + '.ts') }
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
