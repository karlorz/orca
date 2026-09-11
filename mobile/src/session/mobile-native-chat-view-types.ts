import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type {
  NativeChatLiveTurnIndicator,
  NativeChatSettledTurns
} from '../../../src/shared/native-chat-turn-status'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import type { MobileChatQuestion } from './mobile-native-chat-question'
import type { MobileNativeChatPendingItem } from './mobile-native-chat-render-data'
import type { MobileNativeChatSessionOptionPickersProps } from './MobileNativeChatSessionOptionPickers'
import type { MobileNativeChatStatus } from './use-mobile-native-chat-session'

/** Why the composer input is locked: the transport is disconnected, or the
 * terminal subscription has not acknowledged its input lease yet. */
export type MobileNativeChatInputLockReason = 'disconnected' | 'waiting'

export type MobileNativeChatViewProps = {
  /** Raw transcript, only for telling "still loading" from "loaded and empty". */
  messages: NativeChatMessage[]
  /** `messages` with noise stripped and tool turns folded in, from the overlay. */
  folded: NativeChatMessage[]
  status: MobileNativeChatStatus
  error?: string
  /** Resolved agent for this chat; names the empty-state copy (desktop parity). */
  agent?: string | null
  agentWorking?: boolean
  canStop?: boolean
  /** Structured lane: per-turn "Working for N" status plus live tool progress,
   * replacing the bridge lane's static three-dot working row (desktop parity). */
  structuredActivityUi?: boolean
  /** What labels the live turn's one indicator row (structured lane only). */
  turnIndicator?: NativeChatLiveTurnIndicator | null
  workingStartedAt?: number | null
  settledTurns?: NativeChatSettledTurns | null
  /** Interrupt the agent mid-turn (shown as a Stop button on the working bar). */
  onStop?: () => void
  /** Live partial assistant text to show as an in-progress bubble, already gated
   * by the overlay against the transcript catching up. */
  streaming: string | null
  hasMore?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => void
  onSend: (text: string) => Promise<boolean>
  /** Route identity used to fence accepted sends that settle after a tab/view switch. */
  sendSurfaceId: string
  /** Reads the retained route's focus generation for accepted-send fencing. */
  getSendCompletionGeneration: () => number
  /** Reads user draft mutations from the route-owned controller. */
  getComposerEditGeneration: () => number
  /** Accepted user echoes awaiting transcript replacement, including image previews. */
  pending: MobileNativeChatPendingItem[]
  /** Local photo URIs retained when the authoritative transcript replaces an
   * optimistic image bubble. */
  imagePreviewsByMessageId?: Record<string, string[]>
  /** Controlled composer text (owned by the route so dictation can write to it). */
  composerText: string
  onComposerTextChange: (text: string) => void
  onAttachImage?: () => void
  /** Pending image attachments shown as composer thumbnails until the next send. */
  attachments?: PendingNativeChatImage[]
  onRemoveAttachment?: (id: string) => void
  isAttaching?: boolean
  onMicPress?: () => void
  micActive?: boolean
  dictationMode?: 'toggle' | 'hold'
  onMicPressIn?: () => void
  onMicPressOut?: () => void
  inputLockReason?: MobileNativeChatInputLockReason | null
  /** Route-reported send failure (answer cards, permission replies, stop). Shares the
   * inline banner with a rejected composer send, so one failure paints once. The
   * route routes these here only while this view is mounted, and falls back to its
   * toast otherwise — a deferred failure must not land on an unmounted banner. */
  sendErrorMessage?: string | null
  /** Clears `sendErrorMessage` once a later send is accepted. */
  onClearSendError?: () => void
  filePaths?: string[]
  onNeedFiles?: (query: string) => void
  /** Model/session-option pickers for the composer action row (desktop parity). */
  sessionOptions?: MobileNativeChatSessionOptionPickersProps | null
  /** Structured AskUserQuestion prompt parsed from the transcript. */
  ask?: AskPrompt | null
  /** Stable key for the ask card. */
  askKey?: string | null
  onDismissAsk?: () => void
  onAnswerAsk?: (prompt: AskPrompt, selections: AskAnswerSelection[]) => Promise<boolean>
  onCancelAsk?: () => Promise<boolean>
  question?: MobileChatQuestion | null
  onAnswerQuestion?: (text: string) => Promise<boolean>
  permission?: MobileChatPermission | null
  onRespondPermission?: (send: string) => Promise<boolean>
  onOpenFile?: (relativePath: string) => void
  keyboardInset?: number
}
