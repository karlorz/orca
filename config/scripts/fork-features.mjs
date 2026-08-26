import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

export function loadForkFeatures(featuresPath) {
  const registry = parse(readFileSync(featuresPath, 'utf8'))
  if (!registry?.fork || !Array.isArray(registry.features)) {
    throw new Error(`Invalid fork-features registry: ${featuresPath}`)
  }
  return registry
}

export function listForkFeatures(featuresPath) {
  const registry = loadForkFeatures(featuresPath)
  return registry.features.map((feature) => {
    const paths = Array.isArray(feature.paths) ? feature.paths.join(',') : ''
    return [feature.id, feature.kind, feature.status, feature.title, paths].join('\t')
  })
}

function main(argv) {
  const command = argv[0] ?? 'list'
  const featuresPath = new URL('../fork-features.yml', import.meta.url)
  if (command === 'list') {
    for (const row of listForkFeatures(featuresPath)) {
      console.log(row)
    }
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
}
