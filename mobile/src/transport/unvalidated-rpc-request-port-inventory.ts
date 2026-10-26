// Fence raw sendRequest access/selectors, sendSingleFlightRequest calls and raw-port imports per file.
// Counts are ceilings that only shrink; the boundary test rejects new, missing or increased entries.
// Owners implement or route the port; migrate pending callers only after recording their existing behavior.
export type UnvalidatedRpcRequestPortEntry = {
  readonly file: string
  readonly references: number
}

/** Modules whose job is the port. These do not shrink to zero. */
export const UNVALIDATED_RPC_REQUEST_PORT_OWNERS: readonly UnvalidatedRpcRequestPortEntry[] = [
  // Forward raw page requests without choosing a method or decoding replies.
  { file: 'src/mobile-web-shell/bridge-host-requests.ts', references: 3 },
  // Expose the port to the page without interpreting its requests or replies.
  { file: 'src/mobile-web-shell/bridge/bridge-rpc-client.ts', references: 1 },
  // Fakes the port for the bridge host suites; a non-test file only because tsconfig excludes tests.
  { file: 'src/mobile-web-shell/bridge-host-test-fakes.ts', references: 1 },
  // Implements the port over the device-to-host websocket.
  { file: 'src/transport/direct-rpc-client.ts', references: 3 },
  // Fakes the port for the supervisor suites; a non-test file only because tsconfig excludes tests.
  { file: 'src/transport/mobile-endpoint-supervisor-test-fakes.ts', references: 2 },
  // Implements the port over a relay channel.
  { file: 'src/transport/mobile-relay-physical-client.ts', references: 2 },
  // Supplies the port for one relay session.
  { file: 'src/transport/mobile-relay-rpc-session.ts', references: 1 },
  // A second raw sender: string method in, unread envelope out. Its callers are fenced too.
  { file: 'src/transport/request-single-flight.ts', references: 3 },
  // Owns connect-wait, timeout and replay bookkeeping for every raw request.
  { file: 'src/transport/rpc-client-request-tracker.ts', references: 1 },
  // Composes the port into RpcClient, which is why every holder of a client still carries it.
  { file: 'src/transport/rpc-client.ts', references: 2 },
  // The typed boundary itself — the one module that turns a reply into a declared type.
  { file: 'src/transport/rpc-operation.ts', references: 5 },
  // Forwards the port with the workspace's execution host stamped on; picks no method.
  { file: 'src/transport/execution-host-scoped-rpc-client.ts', references: 2 },
  // Forwards the port across a physical-client cutover.
  { file: 'src/transport/stable-logical-rpc-client.ts', references: 2 },
  // Names the port as the recording oracle's sender contract; a non-test file for the same reason.
  { file: 'src/test-support/rpc-recording/recording-scenario.ts', references: 1 },
  // Record names once per logical call above physical replay and below asynchronous wrappers.
  { file: 'src/test-support/rpc-recording/scripted-rpc-transport.ts', references: 7 }
]

/** Call sites awaiting migration to a typed operation. Grouped by the feature area that owns them. */
export const UNVALIDATED_RPC_REQUEST_PORT_PENDING: readonly UnvalidatedRpcRequestPortEntry[] = [
  // Accounts recording needs useFocusEffect/ScrollView substitutes and an accounts.subscribe stream scenario.
  { file: 'src/accounts/MobileAccountsScreen.tsx', references: 2 },

  // src/components/ — shared widgets that fetch their own data. Nothing is left here: the New
  // Workspace drawer's execution target, setup hook, runtime context and Codex capability probe
  // migrated in step 4, and the last two followed once a scenario could declare the device store
  // both of them read. See new-workspace-operations.ts,
  // codex-reset-credit-{capability,consume}-operations.ts, the SSH and agent-detection operations
  // in tasks/mobile-workspace-source-operations.ts, and the repo.list readers the dialog now shares
  // in session/mobile-session-read-operations.ts.

  // src/host-screen/ — host screen catalog and actions. Nothing is left here: the repo and label
  // metadata reads, the desktop view-settings mirror and the list's pin, remove and activate
  // mutations migrated in step 4, and the row sleep followed once it moved into the actions hook;
  // see host-screen-operations.ts.

  // src/notifications/ — push registration and delivery. Nothing is left here. Registration and
  // unregistration migrated in step 4; see mobile-push-registration-operations.ts. Tray
  // reconciliation followed once a scenario could declare the notification tray and the stored host
  // list it resolves against; see push-dismissal-operations.ts. The stream's `notifications.unsubscribe`
  // is no longer a request here: the stream transport sends it with the id from the current `ready`.

  // src/pet-speak/ — fork pet voice sink (status, accepted, complete, unsubscribe)
  { file: 'src/pet-speak/pet-speak-root-bridge.tsx', references: 1 },
  { file: 'src/pet-speak/pet-speak-subscription.ts', references: 5 },

  // src/session/ — session screen: chat, diff review, PR actions, tabs. The github.* PR surface,
  // the diff-review loaders and the rest of the screen migrated in step 4; see
  // mobile-session-{read,write,launch}-operations.ts, mobile-clipboard-image-operations.ts and
  // mobile-diff-review-git-operations.ts. The terminal input surface followed: the composed send,
  // the live keystroke send, the clipboard paste and — in step 6 — the gesture flush all send
  // through terminal.input-send in terminal/mobile-terminal-operations.ts, the menu's clear goes
  // through terminal.clear-buffer-or-skip beside it, and the accessory's connection lookup reads
  // the repo list through the new-tab operation. Step 6 also took the two requests that share an
  // effect with a subscribe: the header's live title (worktree.show-record-or-skip) and native
  // chat's older-history page (nativeChat.read-session-page-or-skip), both in
  // mobile-session-read-operations.ts. Step 6's second migration took the last three hooks that
  // were listed here as blocked on a WebView-ref substitute: none of them imports the terminal
  // WebView, and all three sent with no ref at all. The startup effect's two `worktree.activate`
  // sends now reuse host-screen's `worktreeActivate`, and the New Tab create and the terminal
  // menu's display-mode toggle go through session.tabs-create-terminal and
  // terminal.set-display-mode-or-skip in mobile-session-write-operations.ts.
  // Holdout: the method is a parameter. `callAgentSession` takes a method string and a generic
  // result type, and five call sites across two hooks pass their own, plus one inside this module's
  // own mutation wrapper; an operation fixes the method at definition time, so migrating it is a
  // restructure of those callers rather than of this send.
  { file: 'src/session/mobile-structured-agent-session-rpc.ts', references: 1 },
  // The recorded create-terminal prompt uses a unique empty-refusal fallback absent from existing terminal.send operations.
  { file: 'src/session/use-mobile-session-terminal-create-actions.ts', references: 1 },

  // Dynamic git action steps must be typed before this dispatcher can use fixed-method operations.
  { file: 'src/source-control/use-mobile-git-requests.ts', references: 1 },

  // Scanner references the literal sendRequest without sending requests.
  { file: 'src/tasks/mobile-tasks-source-family.test-support.ts', references: 1 },

  // Wraps a PairingCandidateClient as its raw port; the one chosen method already uses hostStatusProbe.
  { file: 'src/transport/pairing-relay-candidate.ts', references: 4 },
  // Capability negotiation runs before connected and outside the recorder’s client surface; preserve its shared method/params.
  { file: 'src/transport/mobile-runtime-capability-negotiation.ts', references: 2 },
  // Uses hostStatusProbe but accepts a raw sender because push registration holds no full client.
  { file: 'src/transport/runtime-status-probe.ts', references: 1 }
]
