import { useCallback, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  deleteDictationModel,
  downloadDictationModel,
  setDictationConfig,
  type MobileSpeechModel,
  type MobileSpeechSetup
} from './mobile-dictation-setup'

export type ModelBusyAction = { modelId: string; type: 'download' | 'select' | 'delete' }

type UseVoiceSettingsActionsParams = {
  client: RpcClient | null
  setup: MobileSpeechSetup | null
  setSetup: (
    value: MobileSpeechSetup | null | ((prev: MobileSpeechSetup | null) => MobileSpeechSetup | null)
  ) => void
  setError: (error: string | null) => void
  refreshSetup: () => Promise<void>
  setModelDrawerOpen: (open: boolean) => void
}

export function useVoiceSettingsActions({
  client,
  setup,
  setSetup,
  setError,
  refreshSetup,
  setModelDrawerOpen
}: UseVoiceSettingsActionsParams) {
  const [busyAction, setBusyAction] = useState<ModelBusyAction | null>(null)

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!client) {
        return
      }
      setError(null)
      setSetup((prev) => (prev ? { ...prev, enabled } : prev))
      try {
        setSetup(await setDictationConfig(client, { enabled }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
        void refreshSetup()
      }
    },
    [client, refreshSetup, setError, setSetup]
  )

  const handleToggleUseMacSpeech = useCallback(
    async (useMacSpeech: boolean) => {
      if (!client) {
        return
      }
      setError(null)
      setSetup((prev) => (prev ? { ...prev, useMacSpeech } : prev))
      try {
        setSetup(await setDictationConfig(client, { useMacSpeech }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
        void refreshSetup()
      }
    },
    [client, refreshSetup, setError, setSetup]
  )

  const handleSelectMode = useCallback(
    async (dictationMode: 'toggle' | 'hold') => {
      if (!client) {
        return
      }
      setError(null)
      setSetup((prev) => (prev ? { ...prev, dictationMode } : prev))
      try {
        setSetup(await setDictationConfig(client, { dictationMode }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
        void refreshSetup()
      }
    },
    [client, refreshSetup, setError, setSetup]
  )

  const handleUseModel = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      setBusyAction({ modelId: model.id, type: 'select' })
      setError(null)
      try {
        setSetup(await setDictationConfig(client, { enabled: true, modelId: model.id }))
        setModelDrawerOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not select model')
      } finally {
        setBusyAction(null)
      }
    },
    [client, setError, setModelDrawerOpen, setSetup]
  )

  const handleDownload = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      setBusyAction({ modelId: model.id, type: 'download' })
      setError(null)
      try {
        await downloadDictationModel(client, model.id)
        await refreshSetup()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Download failed')
      } finally {
        setBusyAction(null)
      }
    },
    [client, refreshSetup, setError]
  )

  const handleDelete = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      const deletedSelectedModel = setup?.selectedModelId === model.id
      setBusyAction({ modelId: model.id, type: 'delete' })
      setError(null)
      try {
        setSetup(await deleteDictationModel(client, model.id))
        if (deletedSelectedModel) {
          setModelDrawerOpen(false)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setBusyAction(null)
      }
    },
    [client, setError, setModelDrawerOpen, setSetup, setup?.selectedModelId]
  )

  return {
    busyAction,
    handleToggleEnabled,
    handleToggleUseMacSpeech,
    handleSelectMode,
    handleUseModel,
    handleDownload,
    handleDelete
  }
}
