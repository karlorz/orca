import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceModelList } from './VoiceModelList'
import type { MobileSpeechModel, MobileSpeechSetup } from '../dictation/mobile-dictation-setup'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Download: 'Download',
  Trash2: 'Trash2'
}))

function makeModel(overrides: Partial<MobileSpeechModel>): MobileSpeechModel {
  return {
    id: 'test-model',
    label: 'Test Model',
    provider: 'local',
    sizeBytes: 100_000_000,
    recommended: false,
    status: 'ready',
    progress: null,
    ...overrides
  }
}

function makeSetup(models: MobileSpeechModel[], selectedModelId = ''): MobileSpeechSetup {
  return {
    enabled: true,
    selectedModelId,
    dictationMode: 'toggle',
    models
  }
}

describe('VoiceModelList', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('renders a ready system model with Use / In use only and no Trash or Download', async () => {
    const systemModel = makeModel({
      id: 'mac-system-speech',
      label: 'Mac speech',
      provider: 'system',
      sizeBytes: null,
      status: 'ready'
    })

    const onUseModel = vi.fn()
    const onDownload = vi.fn()
    const onDelete = vi.fn()

    await act(async () => {
      renderer = create(
        createElement(VoiceModelList, {
          setup: makeSetup([systemModel], ''),
          disabled: false,
          busyAction: null,
          onUseModel,
          onDownload,
          onDelete
        })
      )
    })

    // No Trash button or Download button
    expect(renderer!.root.findAllByType('Trash2')).toHaveLength(0)
    expect(renderer!.root.findAllByType('Download')).toHaveLength(0)

    // No MB size in text
    const allTexts = renderer!.root.findAllByType('Text')
    const textsCombined = allTexts.flatMap((t) => t.props.children).join(' ')
    expect(textsCombined).not.toContain('MB')

    // Find the Use action pressable
    const pressables = renderer!.root.findAllByType('Pressable')
    expect(pressables).toHaveLength(1)
    await act(async () => {
      pressables[0].props.onPress()
    })
    expect(onUseModel).toHaveBeenCalledWith(systemModel)
    expect(onDownload).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('renders a ready system model when selected as "In use" with Check icon', async () => {
    const systemModel = makeModel({
      id: 'mac-system-speech',
      label: 'Mac speech',
      provider: 'system',
      sizeBytes: null,
      status: 'ready'
    })

    await act(async () => {
      renderer = create(
        createElement(VoiceModelList, {
          setup: makeSetup([systemModel], 'mac-system-speech'),
          disabled: false,
          busyAction: null,
          onUseModel: vi.fn(),
          onDownload: vi.fn(),
          onDelete: vi.fn()
        })
      )
    })

    expect(renderer!.root.findAllByType('Check')).toHaveLength(1)
    expect(renderer!.root.findAllByType('Pressable')).toHaveLength(0)
  })

  it('renders an unavailable system model with muted "Mac only" text and not selectable', async () => {
    const systemModel = makeModel({
      id: 'mac-system-speech',
      label: 'Mac speech',
      provider: 'system',
      sizeBytes: null,
      status: 'unavailable',
      unavailableReason: 'mac-only'
    })

    const onUseModel = vi.fn()
    const onDownload = vi.fn()
    const onDelete = vi.fn()

    await act(async () => {
      renderer = create(
        createElement(VoiceModelList, {
          setup: makeSetup([systemModel], ''),
          disabled: false,
          busyAction: null,
          onUseModel,
          onDownload,
          onDelete
        })
      )
    })

    // No Pressable action buttons
    expect(renderer!.root.findAllByType('Pressable')).toHaveLength(0)

    // Contains Mac only
    const allTexts = renderer!.root.findAllByType('Text')
    const textsCombined = allTexts.flatMap((t) => t.props.children).join(' ')
    expect(textsCombined).toContain('Mac only')
    expect(textsCombined).not.toContain('MB')
  })
})
