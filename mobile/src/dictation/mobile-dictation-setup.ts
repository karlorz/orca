import type { RuntimeSpeechSetupState } from '../../../src/shared/runtime-types'
import { MAC_SYSTEM_SPEECH_MODEL_ID } from '../../../src/shared/voice-dictation-selection'
import type { RpcClient } from '../transport/rpc-client'
import { LogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type { RpcSuccess } from '../transport/types'

export type MobileSpeechSetup = RuntimeSpeechSetupState
export type MobileSpeechModel = RuntimeSpeechSetupState['models'][number]

// Dictation-setup errors startMobileDictation throws when the desktop isn't
// configured. Mapping them lets the mic entry point open the setup sheet
// instead of dead-ending on a toast.
const SETUP_REQUIRED_CODES = new Set(['voice_dictation_disabled', 'voice_model_not_selected'])
const LEGACY_DESKTOP_SPEECH_SETUP_MESSAGE =
  'Update the paired desktop Orca app to use mobile voice settings.'

// Why: mobile can pair with older desktop runtimes that predate speech.models.list;
// show upgrade guidance instead of leaking the raw denial or not-found error.
function isLegacyDesktopSpeechSetupError(
  error: { code?: string; message?: string } | undefined
): boolean {
  const message = error?.message ?? ''
  return (
    message.includes('speech.models.list') &&
    (error?.code === 'method_not_found' || message.includes('not available to mobile clients'))
  )
}

export function isDictationSetupRequiredError(message: string): boolean {
  return SETUP_REQUIRED_CODES.has(message) || message.startsWith('voice_model_not_ready:')
}

export async function fetchDictationSetup(
  client: Pick<RpcClient, 'sendRequest'>
): Promise<MobileSpeechSetup> {
  const response = await fetchDictationSetupResponse(client)
  if (!response.ok) {
    if (isLegacyDesktopSpeechSetupError(response.error)) {
      throw new Error(LEGACY_DESKTOP_SPEECH_SETUP_MESSAGE)
    }
    throw new Error(response.error?.message || 'Failed to load dictation models')
  }
  return (response as RpcSuccess).result as MobileSpeechSetup
}

async function fetchDictationSetupResponse(client: Pick<RpcClient, 'sendRequest'>) {
  try {
    return await client.sendRequest('speech.models.list', null)
  } catch (error) {
    if (!(error instanceof LogicalClientCutoverError)) {
      throw error
    }
    // Why: this read can safely repeat on the authenticated replacement; mutation
    // RPCs must still surface cutover so callers never replay unknown commits.
    return client.sendRequest('speech.models.list', null)
  }
}

export async function downloadDictationModel(
  client: Pick<RpcClient, 'sendRequest'>,
  modelId: string
): Promise<void> {
  const response = await client.sendRequest('speech.models.download', { modelId })
  if (!response.ok) {
    throw new Error(response.error?.message || 'Failed to start download')
  }
}

export async function deleteDictationModel(
  client: Pick<RpcClient, 'sendRequest'>,
  modelId: string
): Promise<MobileSpeechSetup> {
  const response = await client.sendRequest('speech.models.delete', { modelId })
  if (!response.ok) {
    throw new Error(response.error?.message || 'Failed to delete model')
  }
  return (response as RpcSuccess).result as MobileSpeechSetup
}

export function resolveMobileDictationSetupParams(params: {
  enabled?: boolean
  modelId?: string
  useMacSpeech?: boolean
  dictationMode?: 'toggle' | 'hold'
}): {
  enabled?: boolean
  modelId?: string
  useMacSpeech?: boolean
  dictationMode?: 'toggle' | 'hold'
} {
  // Why: packaged 1.4.200-4 strips useMacSpeech on speech.dictation.setup; modelId still lands.
  if (params.useMacSpeech === true && params.modelId === undefined) {
    return { ...params, modelId: MAC_SYSTEM_SPEECH_MODEL_ID }
  }
  return params
}

export function assertMacSpeechWriteApplied(
  requested: { useMacSpeech?: boolean },
  next: MobileSpeechSetup
): void {
  if (requested.useMacSpeech === undefined) {
    return
  }
  const applied = next.useMacSpeech === true && next.macSpeechAvailable
  if (requested.useMacSpeech === applied) {
    return
  }
  throw new Error(
    requested.useMacSpeech
      ? 'Desktop did not enable Mac speech. Pair a Mac running Orca.'
      : 'This desktop Orca build cannot turn Mac speech off from the phone. Use desktop Settings → Voice.'
  )
}

export async function setDictationConfig(
  client: Pick<RpcClient, 'sendRequest'>,
  params: {
    enabled?: boolean
    modelId?: string
    useMacSpeech?: boolean
    dictationMode?: 'toggle' | 'hold'
  }
): Promise<MobileSpeechSetup> {
  const setupParams = resolveMobileDictationSetupParams(params)
  const response = await client.sendRequest('speech.dictation.setup', setupParams)
  if (!response.ok) {
    throw new Error(response.error?.message || 'Failed to update dictation settings')
  }
  const next = (response as RpcSuccess).result as MobileSpeechSetup
  assertMacSpeechWriteApplied(params, next)
  return next
}

// A model is mid-download (or extracting) and the sheet should keep polling.
export function isModelInFlight(model: MobileSpeechModel): boolean {
  return model.status === 'downloading' || model.status === 'extracting'
}

// Whether dictation can be used right now: enabled + (Mac speech or a selected model that's ready).
export function isDictationReady(setup: MobileSpeechSetup): boolean {
  if (!setup.enabled) {
    return false
  }
  if (setup.useMacSpeech && setup.macSpeechAvailable) {
    return true
  }
  if (!setup.selectedModelId) {
    return false
  }
  const selected = setup.models.find((m) => m.id === setup.selectedModelId)
  return selected?.status === 'ready'
}
