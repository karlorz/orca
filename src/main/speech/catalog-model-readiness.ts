import type { SpeechModelManifest, SpeechModelState } from '../../shared/speech-types'

export function readinessForCatalogModel(
  manifest: SpeechModelManifest,
  platform: NodeJS.Platform,
  openAiKeyPresent: boolean
): SpeechModelState | null {
  if (manifest.provider === 'system') {
    return {
      id: manifest.id,
      status: platform === 'darwin' ? 'ready' : 'unavailable'
    }
  }
  if (manifest.provider === 'openai') {
    return {
      id: manifest.id,
      status: openAiKeyPresent ? 'ready' : 'not-downloaded'
    }
  }
  return null
}
