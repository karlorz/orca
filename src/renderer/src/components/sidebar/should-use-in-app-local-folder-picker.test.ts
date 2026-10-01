import { describe, expect, it } from 'vitest'
import { shouldUseInAppLocalFolderPicker } from './should-use-in-app-local-folder-picker'

describe('shouldUseInAppLocalFolderPicker', () => {
  it('uses the in-app browser on Linux', () => {
    expect(shouldUseInAppLocalFolderPicker('linux')).toBe(true)
  })

  it('keeps the native picker on macOS and Windows', () => {
    expect(shouldUseInAppLocalFolderPicker('darwin')).toBe(false)
    expect(shouldUseInAppLocalFolderPicker('win32')).toBe(false)
  })

  it('keeps the native picker when the platform API is unavailable', () => {
    expect(shouldUseInAppLocalFolderPicker()).toBe(false)
  })
})
