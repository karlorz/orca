import { useCallback } from 'react'
import type { AddRepoDialogStep } from './add-repo-dialog-types'

export function useAddRepoDialogChromeHandlers({
  closeModal,
  isAdding,
  resetState,
  step,
  trackNestedBackAction
}: {
  closeModal: () => void
  isAdding: boolean
  resetState: () => void
  step: AddRepoDialogStep
  trackNestedBackAction: () => void
}) {
  const handleBack = useCallback(() => {
    if (step === 'nested') {
      trackNestedBackAction()
    }
    resetState()
  }, [resetState, step, trackNestedBackAction])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (step === 'nested' && !isAdding) {
          trackNestedBackAction()
        }
        closeModal()
        resetState()
      }
    },
    [closeModal, isAdding, resetState, step, trackNestedBackAction]
  )

  return { handleBack, handleOpenChange }
}
