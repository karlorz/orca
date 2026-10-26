const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '..', 'src', 'shared')

const config = getDefaultConfig(projectRoot)

// Watch repo root: mobile source-control uses desktop’s pure prompt builders, outside Metro’s default mobile-only scope.
config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), sharedRoot]))

// Why: babel-preset-expo inlines EXPO_PUBLIC_MOBILE_UPDATE_REPO at transform time (see
// `buildTimeMobileUpdateRepo`), but nothing Metro hashes into the transform cache key carries that
// value, so a warm cache from another build could bake the wrong update repo into a release. Unset
// keys as `default`, which is what a build without the variable always had.
const updateRepoKey = process.env.EXPO_PUBLIC_MOBILE_UPDATE_REPO || 'default'
config.cacheVersion = `${config.cacheVersion}-update-${updateRepoKey}`

module.exports = config
