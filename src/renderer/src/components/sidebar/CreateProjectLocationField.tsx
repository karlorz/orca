import { Folder, FolderOpen, Pencil } from 'lucide-react'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RemoteFileBrowser } from './RemoteFileBrowser'
import { translate } from '@/i18n/i18n'

type CreateProjectParentBrowserProps = {
  runtimeEnvironmentId?: string | null
  sshTargetId?: string | null
  local?: boolean
  createParent: string
  onParentChange: (value: string) => void
  onClose: () => void
}

export function CreateProjectParentBrowser({
  runtimeEnvironmentId,
  sshTargetId,
  local = false,
  createParent,
  onParentChange,
  onClose
}: CreateProjectParentBrowserProps): React.JSX.Element {
  const selectPath = (path: string): void => {
    onParentChange(path)
    onClose()
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {translate(
            'auto.components.sidebar.CreateProjectLocationField.f520f83a97',
            'Browse host filesystem'
          )}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'auto.components.sidebar.CreateProjectLocationField.b589b77997',
            'Navigate to a directory and click Select to choose it.'
          )}
        </DialogDescription>
      </DialogHeader>
      <RemoteFileBrowser
        local={local}
        targetId={sshTargetId ?? undefined}
        runtimeEnvironmentId={runtimeEnvironmentId ?? undefined}
        initialPath={createParent || '~'}
        onSelect={selectPath}
        onCancel={onClose}
      />
    </>
  )
}

type CreateProjectLocationFieldProps = {
  createParent: string
  isCreating: boolean
  manualParentEntry: boolean
  runtimeEnvironmentId?: string | null
  sshTargetId?: string | null
  useLocalFilesystemBrowser?: boolean
  onParentChange: (value: string) => void
  onPickParent: () => void
  onBrowseServer: () => void
}

export function CreateProjectLocationField({
  createParent,
  isCreating,
  manualParentEntry,
  runtimeEnvironmentId,
  sshTargetId,
  useLocalFilesystemBrowser = false,
  onParentChange,
  onPickParent,
  onBrowseServer
}: CreateProjectLocationFieldProps): React.JSX.Element {
  const canBrowseHostFilesystem =
    Boolean(runtimeEnvironmentId) || Boolean(sshTargetId) || useLocalFilesystemBrowser
  const handleBrowse = (): void => {
    if (canBrowseHostFilesystem) {
      onBrowseServer()
      return
    }
    onPickParent()
  }
  return (
    <div className="space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground block">
        {translate('auto.components.sidebar.CreateProjectLocationField.134e37f711', 'Location')}
      </span>

      {manualParentEntry ? (
        <div className="flex gap-2">
          <Input
            value={createParent}
            onChange={(e) => onParentChange(e.target.value)}
            placeholder={translate(
              'auto.components.sidebar.CreateProjectLocationField.2a20a603a3',
              '/home/user/projects'
            )}
            className="h-11 min-w-0 flex-1 text-sm font-mono"
            disabled={isCreating}
            spellCheck={false}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={handleBrowse}
                disabled={isCreating}
                aria-label={translate(
                  'auto.components.sidebar.CreateProjectLocationField.f520f83a97',
                  'Browse host filesystem'
                )}
              >
                <FolderOpen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {translate(
                'auto.components.sidebar.CreateProjectLocationField.f520f83a97',
                'Browse host filesystem'
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : createParent ? (
        <div className="group flex items-center gap-2.5 rounded-md border border-border bg-background/40 h-11 min-w-0 px-3 text-sm">
          <span className="flex-1 min-w-0 truncate font-mono text-[12px]" title={createParent}>
            {createParent}
          </span>
          <button
            type="button"
            onClick={handleBrowse}
            disabled={isCreating}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:cursor-not-allowed"
            aria-label={translate(
              'auto.components.sidebar.CreateProjectLocationField.afaf54f245',
              'Change parent folder'
            )}
          >
            <Pencil className="size-3" />
            {translate('auto.components.sidebar.CreateProjectLocationField.632b456b1b', 'Change')}
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={handleBrowse}
          disabled={isCreating}
          className="w-full h-11 justify-start text-sm text-muted-foreground font-normal gap-2.5"
        >
          <span className="shrink-0 inline-flex items-center justify-center size-7 rounded-md border border-border/70 bg-background/40">
            <Folder className="size-3.5" />
          </span>
          {translate(
            'auto.components.sidebar.CreateProjectLocationField.95548e33bf',
            'Choose parent folder...'
          )}
        </Button>
      )}
    </div>
  )
}
