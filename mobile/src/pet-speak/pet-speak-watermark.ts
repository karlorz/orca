import {
  createWatermarkStore,
  type PersistedWatermark,
  type LoadedWatermark
} from '../storage/watermark-storage'

export type PersistedPetSpeakWatermark = PersistedWatermark
export type LoadedPetSpeakWatermark = LoadedWatermark

const WATERMARK_STORAGE_KEY_PREFIX = 'orca:petSpeakWatermark:'

const petSpeakWatermarkStore = createWatermarkStore({
  prefix: WATERMARK_STORAGE_KEY_PREFIX,
  monotonicOnly: true
})

export const loadPetSpeakWatermark = (hostId: string) =>
  petSpeakWatermarkStore.loadWatermark(hostId)

export const clearPetSpeakWatermark = (hostId: string) =>
  petSpeakWatermarkStore.clearWatermark(hostId)

export const savePetSpeakWatermark = (hostId: string, watermark: PersistedPetSpeakWatermark) =>
  petSpeakWatermarkStore.saveWatermark(hostId, watermark)
