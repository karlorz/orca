import { describe, expect, it } from 'vitest'
import {
  resolveTerminalRightClickAction,
  type TerminalRightClickAction
} from './terminal-right-click-ownership'

describe('resolveTerminalRightClickAction', () => {
  describe('pane header (not from terminal content)', () => {
    it('always resolves to orca-menu regardless of mouseTrackingMode or rightClickToPaste', () => {
      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: false,
          mouseTrackingMode: 'any',
          rightClickToPaste: true,
          event: { ctrlKey: false, altKey: false, shiftKey: false },
          isMac: false
        })
      ).toBe<TerminalRightClickAction>('orca-menu')

      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: false,
          mouseTrackingMode: 'drag',
          rightClickToPaste: false,
          event: { ctrlKey: false, altKey: false, shiftKey: false },
          isMac: true
        })
      ).toBe<TerminalRightClickAction>('orca-menu')
    })
  })

  describe('active terminal mouse tracking (x10, vt200, drag, any)', () => {
    const activeModes = ['x10', 'vt200', 'drag', 'any'] as const

    for (const mode of activeModes) {
      it(`ordinary right-click with mode=${mode} forwards to terminal app on all platforms`, () => {
        expect(
          resolveTerminalRightClickAction({
            fromTerminalContent: true,
            mouseTrackingMode: mode,
            rightClickToPaste: false,
            event: { ctrlKey: false, altKey: false, shiftKey: false },
            isMac: true
          })
        ).toBe<TerminalRightClickAction>('terminal-app')

        expect(
          resolveTerminalRightClickAction({
            fromTerminalContent: true,
            mouseTrackingMode: mode,
            rightClickToPaste: false,
            event: { ctrlKey: false, altKey: false, shiftKey: false },
            isMac: false
          })
        ).toBe<TerminalRightClickAction>('terminal-app')
      })

      it(`rightClickToPaste cannot trigger paste when mode=${mode} (TUI cannot receive both mouse report and paste)`, () => {
        expect(
          resolveTerminalRightClickAction({
            fromTerminalContent: true,
            mouseTrackingMode: mode,
            rightClickToPaste: true,
            event: { ctrlKey: false, altKey: false, shiftKey: false },
            isMac: true
          })
        ).toBe<TerminalRightClickAction>('terminal-app')

        expect(
          resolveTerminalRightClickAction({
            fromTerminalContent: true,
            mouseTrackingMode: mode,
            rightClickToPaste: true,
            event: { ctrlKey: false, altKey: false, shiftKey: false },
            isMac: false
          })
        ).toBe<TerminalRightClickAction>('terminal-app')
      })
    }

    it('macOS: Option/Alt overrides active mouse tracking to Orca menu', () => {
      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: true,
          mouseTrackingMode: 'any',
          rightClickToPaste: false,
          event: { ctrlKey: false, altKey: true, shiftKey: false },
          isMac: true
        })
      ).toBe<TerminalRightClickAction>('orca-menu')
    })

    it('macOS: Shift does not override active mouse tracking to Orca menu', () => {
      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: true,
          mouseTrackingMode: 'any',
          rightClickToPaste: false,
          event: { ctrlKey: false, altKey: false, shiftKey: true },
          isMac: true
        })
      ).toBe<TerminalRightClickAction>('terminal-app')
    })

    it('Linux/Windows: Shift overrides active mouse tracking to Orca menu', () => {
      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: true,
          mouseTrackingMode: 'any',
          rightClickToPaste: false,
          event: { ctrlKey: false, altKey: false, shiftKey: true },
          isMac: false
        })
      ).toBe<TerminalRightClickAction>('orca-menu')
    })

    it('Linux/Windows: Alt is NOT the override to Orca menu', () => {
      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: true,
          mouseTrackingMode: 'any',
          rightClickToPaste: false,
          event: { ctrlKey: false, altKey: true, shiftKey: false },
          isMac: false
        })
      ).toBe<TerminalRightClickAction>('terminal-app')
    })
  })

  describe('no mouse tracking (mouseTrackingMode === "none" or undefined)', () => {
    it('opens Orca menu by default when rightClickToPaste is disabled', () => {
      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: true,
          mouseTrackingMode: 'none',
          rightClickToPaste: false,
          event: { ctrlKey: false, altKey: false, shiftKey: false },
          isMac: true
        })
      ).toBe<TerminalRightClickAction>('orca-menu')

      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: true,
          mouseTrackingMode: undefined,
          rightClickToPaste: false,
          event: { ctrlKey: false, altKey: false, shiftKey: false },
          isMac: false
        })
      ).toBe<TerminalRightClickAction>('orca-menu')
    })

    it('rightClickToPaste applies paste/copy only when mouseTrackingMode is none', () => {
      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: true,
          mouseTrackingMode: 'none',
          rightClickToPaste: true,
          event: { ctrlKey: false, altKey: false, shiftKey: false },
          isMac: false
        })
      ).toBe<TerminalRightClickAction>('paste-or-copy')
    })

    it('Ctrl+right-click overrides rightClickToPaste to open Orca menu', () => {
      expect(
        resolveTerminalRightClickAction({
          fromTerminalContent: true,
          mouseTrackingMode: 'none',
          rightClickToPaste: true,
          event: { ctrlKey: true, altKey: false, shiftKey: false },
          isMac: false
        })
      ).toBe<TerminalRightClickAction>('orca-menu')
    })
  })
})
