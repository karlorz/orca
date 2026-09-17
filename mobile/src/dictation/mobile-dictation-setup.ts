import type { RuntimeSpeechSetupState } from '../../../src/shared/runtime-types'
import { MAC_SYSTEM_SPEECH_MODEL_ID } from '../../../src/shared/voice-dictation-selection'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { interpretOrThrowRefusalMessage } from '../transport/rpc-refusal-message'
import { LogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import {
  dictationConfigWrite,
  dictationModelDelete,
  dictationModelDownload,
  dictationSetupRead
} from './mobile-dictation-operations'

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
// Why the raw reply: this reads the refusal's code alongside its message, and no acceptance
// policy carries both through — the same reason mobile-branch-base-ref.ts keeps its own check.
function isLegacyDesktopSpeechSetupReply(reply: RpcResponse): boolean {
  if (reply.ok) {
    return false
  }
  const message = reply.error?.message ?? ''
  return (
    message.includes('speech.models.list') &&
    (reply.error?.code === 'method_not_found' ||
      message.includes('not available to mobile clients'))
  )
}

export function isDictationSetupRequiredError(message: string): boolean {
  return SETUP_REQUIRED_CODES.has(message) || message.startsWith('voice_model_not_ready:')
}

export async function fetchDictationSetup(client: RpcClient): Promise<MobileSpeechSetup> {
  const reply = await requestDictationSetupReply(client)
  if (isLegacyDesktopSpeechSetupReply(reply)) {
    throw new Error(LEGACY_DESKTOP_SPEECH_SETUP_MESSAGE)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
  return interpretOrThrowRefusalMessage(
    () => dictationSetupRead.interpret(reply),
    'Failed to load dictation models'
  ) as MobileSpeechSetup
}

async function requestDictationSetupReply(client: RpcClient): Promise<RpcResponse> {
  try {
    return await dictationSetupRead.request(client, null)
  } catch (error) {
    if (!(error instanceof LogicalClientCutoverError)) {
      throw error
    }
    // Why: this read can safely repeat on the authenticated replacement; mutation
    // RPCs must still surface cutover so callers never replay unknown commits.
    return dictationSetupRead.request(client, null)
  }
}

export async function downloadDictationModel(client: RpcClient, modelId: string): Promise<void> {
  const reply = await dictationModelDownload.request(client, { modelId })
  interpretOrThrowRefusalMessage(
    () => dictationModelDownload.interpret(reply),
    'Failed to start download'
  )
}

export async function deleteDictationModel(
  client: RpcClient,
  modelId: string
): Promise<MobileSpeechSetup> {
  const reply = await dictationModelDelete.request(client, { modelId })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
  return interpretOrThrowRefusalMessage(
    () => dictationModelDelete.interpret(reply),
    'Failed to delete model'
  ) as MobileSpeechSetup
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
  client: RpcClient,
  params: {
    enabled?: boolean
    modelId?: string
    useMacSpeech?: boolean
    dictationMode?: 'toggle' | 'hold'
  }
): Promise<MobileSpeechSetup> {
  const setupParams = resolveMobileDictationSetupParams(params)
  const reply = await dictationConfigWrite.request(client, setupParams)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
  const next = interpretOrThrowRefusalMessage(
    () => dictationConfigWrite.interpret(reply),
    'Failed to update dictation settings'
  ) as MobileSpeechSetup
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
