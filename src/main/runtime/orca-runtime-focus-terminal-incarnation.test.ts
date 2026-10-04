import { describe, expect, it } from 'vitest'
import { HEADLESS_LEAF_ID } from './orca-runtime-test-fixtures.spec'
import {
  ADOPTED_LEAF_ID,
  ADOPTED_PANE_KEY,
  ADOPTED_SPLIT_LEAF_ID,
  ADOPTED_SPLIT_PANE_KEY,
  ADOPTED_TAB_ID,
  INCARNATION_ID,
  LAUNCH_TOKEN,
  PANE_KEY,
  PTY_ID,
  RENDERER_INCARNATION_ID,
  RENDERER_LEAF_ID,
  RENDERER_PANE_KEY,
  RENDERER_PTY_ID,
  RENDERER_TAB_ID,
  REPLACEMENT_INCARNATION_ID,
  TAB_ID,
  WORKTREE_ID,
  asOwnerBinding,
  focusPathInternals,
  makeAdoptedOwnerRuntime,
  makeOwnerRuntime,
  makeRetainedHandleRuntime,
  type FocusPathInternals,
  type OwnerRecord
} from './orca-runtime-focus-terminal-incarnation-fixtures.spec'

describe('session owner PTY handle on the production reveal route', () => {
  it('mints a PTY handle for an owner the renderer graph does not already back', () => {
    const { runtime } = makeOwnerRuntime()

    const owner = runtime.getSessionTerminalOwner(PANE_KEY)

    expect(owner).toMatchObject({
      runtimeId: runtime.getRuntimeId(),
      executionHostId: 'local',
      ptyId: PTY_ID,
      incarnationId: INCARNATION_ID,
      paneKey: PANE_KEY,
      tabId: TAB_ID,
      leafId: HEADLESS_LEAF_ID,
      worktreeId: WORKTREE_ID,
      launchToken: LAUNCH_TOKEN
    })
    // No renderer tab holds this PTY, so the runtime mints its own `pty:` record identity.
    const record = focusPathInternals(runtime).handles.get(owner!.handle)
    expect(record?.tabId).toBe(`pty:${PTY_ID}`)
    expect(record?.ptyId).toBe(PTY_ID)
  })

  it('navigates through revealSessionTerminal and focuses the same PTY handle once', async () => {
    const { runtime, focusTerminal, revealTerminalSession } = makeOwnerRuntime()
    const owner = runtime.getSessionTerminalOwner(PANE_KEY)!

    const receipt = await runtime.revealSessionTerminal(asOwnerBinding(owner), () => true)

    // Why: an unconfirmed focus observation still accompanies a navigated acknowledgement.
    expect(receipt).toMatchObject({
      navigated: true,
      windowFocused: false,
      paneFocused: false
    })
    expect(revealTerminalSession).toHaveBeenCalledTimes(1)
    expect(revealTerminalSession).toHaveBeenCalledWith(
      WORKTREE_ID,
      expect.objectContaining({
        ptyId: PTY_ID,
        existingSessionOnly: true,
        focus: true,
        expectedProcessIdentity: { terminalHandle: owner.handle, incarnationId: INCARNATION_ID }
      })
    )
    expect(revealTerminalSession.mock.calls[0][1]).not.toHaveProperty('activateHostWindow')
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('forwards host activation permission only when the session navigation authorizes it', async () => {
    const { runtime, revealTerminalSession } = makeOwnerRuntime()
    const owner = runtime.getSessionTerminalOwner(PANE_KEY)!

    await runtime.revealSessionTerminal(asOwnerBinding(owner), () => true, {
      activateHostWindow: true
    })
    await runtime.revealSessionTerminal(asOwnerBinding(owner), () => true)
    await runtime.revealSessionTerminal(asOwnerBinding(owner), () => true, {
      activateHostWindow: false
    })

    expect(revealTerminalSession).toHaveBeenNthCalledWith(
      1,
      WORKTREE_ID,
      expect.objectContaining({ existingSessionOnly: true, activateHostWindow: true })
    )
    expect(revealTerminalSession.mock.calls[1][1]).not.toHaveProperty('activateHostWindow')
    expect(revealTerminalSession.mock.calls[2][1]).not.toHaveProperty('activateHostWindow')
    // Why: a false focus observation is still an acknowledgement of the navigation, never a retry.
    expect(revealTerminalSession).toHaveBeenCalledTimes(3)
  })

  it('forwards host activation permission on a local switch and omits it without that authorization', async () => {
    const { runtime, focusTerminal, revealTerminalSession } = makeOwnerRuntime()
    const owner = runtime.getSessionTerminalOwner(PANE_KEY)!

    await runtime.focusTerminal(owner.handle, { activateHostWindow: true })
    await runtime.focusTerminal(owner.handle)

    expect(revealTerminalSession).toHaveBeenNthCalledWith(
      1,
      WORKTREE_ID,
      expect.objectContaining({ ptyId: PTY_ID, activateHostWindow: true })
    )
    // Why: the paired/remote shape carries neither the activation permission nor the
    // existing-session fence, so the main process can only activate the tab for it.
    expect(revealTerminalSession.mock.calls[0][1]).not.toHaveProperty('existingSessionOnly')
    expect(revealTerminalSession.mock.calls[1][1]).not.toHaveProperty('activateHostWindow')
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('refuses a replaced incarnation before reveal with zero navigation, input or launch', async () => {
    const { runtime, focusTerminal, revealTerminalSession } = makeOwnerRuntime()
    const owner = runtime.getSessionTerminalOwner(PANE_KEY)!
    const pty = focusPathInternals(runtime).ptysById.get(PTY_ID)!
    pty.incarnationId = REPLACEMENT_INCARNATION_ID

    await expect(runtime.revealSessionTerminal(asOwnerBinding(owner), () => true)).rejects.toThrow(
      'session_binding_unverifiable'
    )

    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
    expect(pty.launchToken).toBe(LAUNCH_TOKEN)
  })

  it('refuses a disconnected owner before reveal with zero navigation or focus', async () => {
    const { runtime, focusTerminal, revealTerminalSession } = makeOwnerRuntime()
    const owner = runtime.getSessionTerminalOwner(PANE_KEY)!
    focusPathInternals(runtime).ptysById.get(PTY_ID)!.connected = false

    await expect(runtime.revealSessionTerminal(asOwnerBinding(owner), () => true)).rejects.toThrow(
      'session_binding_unverifiable'
    )

    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
  })
})

describe('retained renderer handle identity fences', () => {
  it('reveals a retained renderer handle whose graph and pane identity all match', async () => {
    const { runtime, focusTerminal, revealTerminalSession, handle } = makeRetainedHandleRuntime()

    const result = await runtime.focusTerminal(handle, {
      expectedIncarnationId: RENDERER_INCARNATION_ID,
      navigateHost: true,
      activateHostWindow: true
    })

    expect(result).toMatchObject({
      handle,
      tabId: RENDERER_TAB_ID,
      worktreeId: WORKTREE_ID,
      navigated: true
    })
    expect(revealTerminalSession).toHaveBeenCalledWith(
      WORKTREE_ID,
      expect.objectContaining({
        ptyId: RENDERER_PTY_ID,
        tabId: RENDERER_TAB_ID,
        leafId: RENDERER_LEAF_ID,
        activateHostWindow: true
      })
    )
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('refuses a retained handle whose record worktree disagrees with its leaf and PTY', async () => {
    const { runtime, focusTerminal, revealTerminalSession, handle } = makeRetainedHandleRuntime()
    focusPathInternals(runtime).handles.get(handle)!.worktreeId = 'other-worktree'

    await expect(
      runtime.focusTerminal(handle, {
        expectedIncarnationId: RENDERER_INCARNATION_ID,
        navigateHost: true
      })
    ).rejects.toThrow('terminal_handle_stale')

    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('refuses a retained handle whose leaf worktree disagrees with the PTY', async () => {
    const { runtime, focusTerminal, revealTerminalSession, handle } = makeRetainedHandleRuntime()
    const leaf = [...focusPathInternals(runtime).leaves.values()].find(
      (candidate) => candidate.tabId === RENDERER_TAB_ID
    )!
    leaf.worktreeId = 'other-worktree'

    await expect(
      runtime.focusTerminal(handle, {
        expectedIncarnationId: RENDERER_INCARNATION_ID,
        navigateHost: true
      })
    ).rejects.toThrow('terminal_handle_stale')

    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('refuses a retained handle whose PTY tab disagrees with the record tab', async () => {
    const { runtime, focusTerminal, revealTerminalSession, handle } = makeRetainedHandleRuntime()
    focusPathInternals(runtime).ptysById.get(RENDERER_PTY_ID)!.tabId = 'other-tab'

    await expect(
      runtime.focusTerminal(handle, {
        expectedIncarnationId: RENDERER_INCARNATION_ID,
        navigateHost: true
      })
    ).rejects.toThrow('terminal_handle_stale')

    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('refuses a retained handle whose PTY pane key names a different leaf', async () => {
    const { runtime, focusTerminal, revealTerminalSession, handle } = makeRetainedHandleRuntime()
    const internals = focusPathInternals(runtime)
    const pty = internals.ptysById.get(RENDERER_PTY_ID)!
    const leaf = [...internals.leaves.values()].find(
      (candidate) => candidate.tabId === RENDERER_TAB_ID
    )!
    pty.paneKey = `${RENDERER_TAB_ID}:${ADOPTED_SPLIT_LEAF_ID}`
    pty.tabId = RENDERER_TAB_ID
    internals.handles.get(handle)!.leafId = leaf.leafId

    await expect(
      runtime.focusTerminal(handle, {
        expectedIncarnationId: RENDERER_INCARNATION_ID,
        navigateHost: true
      })
    ).rejects.toThrow('terminal_handle_stale')

    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('refuses a stale renderer graph epoch with zero navigation', async () => {
    const { runtime, focusTerminal, revealTerminalSession, handle } = makeRetainedHandleRuntime()
    focusPathInternals(runtime).handles.get(handle)!.rendererGraphEpoch =
      focusPathInternals(runtime).rendererGraphEpoch + 1

    await expect(
      runtime.focusTerminal(handle, {
        expectedIncarnationId: RENDERER_INCARNATION_ID,
        navigateHost: true
      })
    ).rejects.toThrow('terminal_handle_stale')

    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('refuses a stale renderer leaf generation with zero navigation', async () => {
    const { runtime, focusTerminal, revealTerminalSession, handle } = makeRetainedHandleRuntime()
    const leaf = [...focusPathInternals(runtime).leaves.values()].find(
      (candidate) => candidate.tabId === RENDERER_TAB_ID
    )!
    leaf.ptyGeneration = 7

    await expect(
      runtime.focusTerminal(handle, {
        expectedIncarnationId: RENDERER_INCARNATION_ID,
        navigateHost: true
      })
    ).rejects.toThrow('terminal_handle_stale')

    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
  })
})

describe('extended retained handle reveal regressions', () => {
  it('refuses an exact-session request with no live pane key before any leaf focus', async () => {
    const { runtime, focusTerminal, revealTerminalSession, createTerminal, writes, handle } =
      makeRetainedHandleRuntime()
    focusPathInternals(runtime).ptysById.get(RENDERER_PTY_ID)!.paneKey = null

    await expect(
      runtime.focusTerminal(handle, {
        expectedIncarnationId: RENDERER_INCARNATION_ID,
        navigateHost: true,
        existingSessionOnly: true
      })
    ).rejects.toThrow('terminal_handle_stale')

    expect(focusTerminal).not.toHaveBeenCalled()
    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('refuses an exact-session request whose leaf and PTY ownership is gone', async () => {
    const { runtime, focusTerminal, revealTerminalSession, createTerminal, writes, handle } =
      makeRetainedHandleRuntime()
    focusPathInternals(runtime).leaves.clear()

    await expect(
      runtime.focusTerminal(handle, {
        expectedIncarnationId: RENDERER_INCARNATION_ID,
        navigateHost: true,
        existingSessionOnly: true
      })
    ).rejects.toThrow('terminal_handle_stale')

    expect(focusTerminal).not.toHaveBeenCalled()
    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('refuses an exact-session request whose owner is disconnected', async () => {
    const { runtime, focusTerminal, revealTerminalSession, createTerminal, writes, handle } =
      makeRetainedHandleRuntime()
    focusPathInternals(runtime).ptysById.get(RENDERER_PTY_ID)!.connected = false

    await expect(
      runtime.focusTerminal(handle, {
        expectedIncarnationId: RENDERER_INCARNATION_ID,
        navigateHost: true,
        existingSessionOnly: true
      })
    ).rejects.toThrow('terminal_handle_stale')

    expect(focusTerminal).not.toHaveBeenCalled()
    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('keeps ordinary leaf focus available when the session-only flag is absent', async () => {
    const { runtime, revealTerminalSession, handle } = makeRetainedHandleRuntime()
    const internals = focusPathInternals(runtime)
    internals.ptysById.get(RENDERER_PTY_ID)!.connected = false

    const result = await runtime.focusTerminal(handle, {
      expectedIncarnationId: RENDERER_INCARNATION_ID,
      navigateHost: true
    })

    expect(result).toMatchObject({ handle, tabId: RENDERER_TAB_ID, navigated: true })
    expect(revealTerminalSession).not.toHaveBeenCalled()
  })

  it('refuses an exact-session reveal when the session changes after the click', async () => {
    const { runtime, focusTerminal, revealTerminalSession, createTerminal, writes } =
      makeAdoptedOwnerRuntime()
    const owner = runtime.getSessionTerminalOwner(ADOPTED_PANE_KEY)!
    const pty = focusPathInternals(runtime).ptysById.get(PTY_ID)!

    await expect(
      runtime.revealSessionTerminal(asOwnerBinding(owner), () => false, {
        activateHostWindow: true
      })
    ).rejects.toThrow('session_navigation_unverifiable')

    expect(revealTerminalSession).toHaveBeenCalledTimes(1)
    expect(focusTerminal).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
    expect(writes).toEqual([])
    expect(pty.launchToken).toBe(LAUNCH_TOKEN)
  })

  it('refuses before activation when the captured identity changes while the reveal is deferred', async () => {
    const cases: { mutate: (internals: FocusPathInternals) => void }[] = [
      {
        mutate: (internals) => {
          internals.ptysById.get(RENDERER_PTY_ID)!.incarnationId = REPLACEMENT_INCARNATION_ID
        }
      },
      {
        mutate: (internals) => {
          internals.ptysById.get(RENDERER_PTY_ID)!.worktreeId = 'other-worktree'
        }
      },
      {
        mutate: (internals) => {
          internals.ptysById.get(RENDERER_PTY_ID)!.tabId = 'repointed-tab'
        }
      }
    ]

    for (const { mutate } of cases) {
      const {
        runtime,
        focusTerminal,
        revealTerminalSession,
        createTerminal,
        writes,
        activations,
        setOnDeferredMutation
      } = makeRetainedHandleRuntime()
      const binding = asOwnerBinding(runtime.getSessionTerminalOwner(RENDERER_PANE_KEY)!)
      setOnDeferredMutation(() => mutate(focusPathInternals(runtime)))

      await expect(
        runtime.revealSessionTerminal(binding, () => true, {
          activateHostWindow: true
        })
      ).rejects.toThrow('session_navigation_unverifiable')

      // The second check runs before OS activation, so the host is never raised for a stale capture.
      expect(activations).toEqual([])
      expect(focusTerminal).not.toHaveBeenCalled()
      expect(createTerminal).not.toHaveBeenCalled()
      expect(writes).toEqual([])
      expect(revealTerminalSession).toHaveBeenCalledTimes(1)
    }
  })

  it('refuses after the renderer reply when the pane is repointed mid reveal', async () => {
    const {
      runtime,
      focusTerminal,
      revealTerminalSession,
      createTerminal,
      writes,
      setOnDeferredMutation
    } = makeRetainedHandleRuntime()
    const binding = asOwnerBinding(runtime.getSessionTerminalOwner(RENDERER_PANE_KEY)!)
    const internals = focusPathInternals(runtime)
    setOnDeferredMutation(() => {
      internals.ptysById.get(RENDERER_PTY_ID)!.tabId = 'repointed-tab'
    })

    await expect(
      runtime.revealSessionTerminal(binding, () => true, {
        activateHostWindow: true
      })
    ).rejects.toThrow('session_navigation_unverifiable')

    // Refusal-only: an activation already acknowledged for this reveal cannot be undone here.
    expect(focusTerminal).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
    expect(writes).toEqual([])
    expect(revealTerminalSession).toHaveBeenCalledTimes(1)
  })
})

describe('adopted renderer-backed canonical owner reveal', () => {
  it('keeps the retained renderer handle and reveals with identity and host activation', async () => {
    const { runtime, focusTerminal, revealTerminalSession, retainedHandle } =
      makeAdoptedOwnerRuntime()

    const owner = runtime.getSessionTerminalOwner(ADOPTED_PANE_KEY)!

    expect(owner.handle).toBe(retainedHandle)
    expect(owner).toMatchObject({
      ptyId: PTY_ID,
      incarnationId: INCARNATION_ID,
      paneKey: ADOPTED_PANE_KEY,
      tabId: ADOPTED_TAB_ID,
      leafId: ADOPTED_LEAF_ID,
      worktreeId: WORKTREE_ID,
      launchToken: LAUNCH_TOKEN
    })
    const record = focusPathInternals(runtime).handles.get(owner.handle)
    expect(record?.tabId).toBe(ADOPTED_TAB_ID)
    expect(record?.tabId.startsWith('pty:')).toBe(false)

    const receipt = await runtime.revealSessionTerminal(asOwnerBinding(owner), () => true, {
      activateHostWindow: true
    })

    expect(receipt).toMatchObject({
      navigated: true,
      identity: {
        worktreeId: WORKTREE_ID,
        tabId: ADOPTED_TAB_ID,
        leafId: ADOPTED_LEAF_ID,
        ptyId: PTY_ID
      },
      paneFocused: true
    })
    expect(revealTerminalSession).toHaveBeenCalledTimes(1)
    expect(revealTerminalSession).toHaveBeenCalledWith(
      WORKTREE_ID,
      expect.objectContaining({
        ptyId: PTY_ID,
        tabId: ADOPTED_TAB_ID,
        leafId: ADOPTED_LEAF_ID,
        existingSessionOnly: true,
        activateHostWindow: true,
        expectedProcessIdentity: {
          terminalHandle: retainedHandle,
          incarnationId: INCARNATION_ID
        }
      })
    )
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('reveals the adopted split tab through its PTY-backed leaf', async () => {
    const { runtime, focusTerminal, revealTerminalSession } = makeAdoptedOwnerRuntime({
      split: true
    })
    const owner = runtime.getSessionTerminalOwner(ADOPTED_PANE_KEY)!

    await runtime.revealSessionTerminal(asOwnerBinding(owner), () => true, {
      activateHostWindow: true
    })

    expect(revealTerminalSession).toHaveBeenCalledWith(
      WORKTREE_ID,
      expect.objectContaining({ leafId: ADOPTED_LEAF_ID, existingSessionOnly: true })
    )
    expect(runtime.getSessionTerminalOwner(ADOPTED_SPLIT_PANE_KEY)).toBeNull()
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  it('refuses a session that changed after adoption with zero keys, input or launch', async () => {
    const { runtime, focusTerminal, revealTerminalSession, createTerminal, writes } =
      makeAdoptedOwnerRuntime()
    const owner = runtime.getSessionTerminalOwner(ADOPTED_PANE_KEY)!
    const pty = focusPathInternals(runtime).ptysById.get(PTY_ID)!

    await expect(
      runtime.revealSessionTerminal(asOwnerBinding(owner), () => false, {
        activateHostWindow: true
      })
    ).rejects.toThrow('session_navigation_unverifiable')

    expect(revealTerminalSession).toHaveBeenCalledTimes(1)
    expect(focusTerminal).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
    expect(writes).toEqual([])
    expect(pty.launchToken).toBe(LAUNCH_TOKEN)
  })

  it('refuses before activation when the captured graph or pane identity goes stale mid reveal', async () => {
    const cases: { mutate: (internals: FocusPathInternals, owner: OwnerRecord) => void }[] = [
      {
        mutate: (internals, owner) => {
          internals.handles.get(owner.handle)!.rendererGraphEpoch = internals.rendererGraphEpoch + 1
        }
      },
      {
        mutate: (internals, owner) => {
          internals.leaves.get(`${owner.tabId}::${owner.leafId}`)!.ptyGeneration += 1
        }
      },
      {
        mutate: (internals) => {
          internals.ptysById.get(PTY_ID)!.paneKey = ADOPTED_SPLIT_PANE_KEY
        }
      }
    ]

    for (const { mutate } of cases) {
      const {
        runtime,
        focusTerminal,
        revealTerminalSession,
        createTerminal,
        writes,
        activations,
        setOnDeferredMutation
      } = makeAdoptedOwnerRuntime()
      const owner = runtime.getSessionTerminalOwner(ADOPTED_PANE_KEY)!
      setOnDeferredMutation(() => mutate(focusPathInternals(runtime), owner))

      await expect(
        runtime.revealSessionTerminal(asOwnerBinding(owner), () => true, {
          activateHostWindow: true
        })
      ).rejects.toThrow('session_navigation_unverifiable')

      expect(activations).toEqual([])
      expect(focusTerminal).not.toHaveBeenCalled()
      expect(createTerminal).not.toHaveBeenCalled()
      expect(writes).toEqual([])
      expect(revealTerminalSession).toHaveBeenCalledTimes(1)
    }
  })

  it('refuses a replaced incarnation after adoption with zero reveal or focus', async () => {
    const { runtime, focusTerminal, revealTerminalSession } = makeAdoptedOwnerRuntime()
    const owner = runtime.getSessionTerminalOwner(ADOPTED_PANE_KEY)!
    focusPathInternals(runtime).ptysById.get(PTY_ID)!.incarnationId = REPLACEMENT_INCARNATION_ID

    await expect(
      runtime.revealSessionTerminal(asOwnerBinding(owner), () => true, {
        activateHostWindow: true
      })
    ).rejects.toThrow('session_binding_unverifiable')

    expect(revealTerminalSession).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
  })
})
