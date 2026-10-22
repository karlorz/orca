import React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export function AgentComboboxClearButton({
  onClear,
  onClosed,
  triggerRef
}: {
  onClear: () => void
  onClosed: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute right-8 top-1/2 -translate-y-1/2"
          aria-label={translate('components.agentCombobox.clearSelection', 'Clear agent selection')}
          onClick={() => {
            onClear()
            onClosed()
            triggerRef.current?.focus()
          }}
        >
          <X />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {translate('components.agentCombobox.clearSelection', 'Clear agent selection')}
      </TooltipContent>
    </Tooltip>
  )
}
