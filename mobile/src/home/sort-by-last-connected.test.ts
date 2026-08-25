import { afterEach, describe, expect, it } from 'vitest'
import { sortByLastConnected } from './sort-by-last-connected'

describe('sortByLastConnected', () => {
  const originalToSorted = Array.prototype.toSorted

  afterEach(() => {
    Object.defineProperty(Array.prototype, 'toSorted', {
      configurable: true,
      writable: true,
      value: originalToSorted
    })
  })

  it('orders by lastConnected descending without Array.prototype.toSorted (Hermes)', () => {
    // Why: RN 0.83 Hermes in this tree has no Array.prototype.toSorted. #16165
    // used hosts.toSorted on home first paint, which throws TypeError and the
    // app never leaves splash. Node/vitest have toSorted, so delete it here.
    // @ts-expect-error Hermes gap
    delete Array.prototype.toSorted
    expect(typeof Array.prototype.toSorted).toBe('undefined')

    const sorted = sortByLastConnected([
      { id: 'old', lastConnected: 10 },
      { id: 'new', lastConnected: 30 },
      { id: 'mid', lastConnected: 20 }
    ])

    expect(sorted.map((item) => item.id)).toEqual(['new', 'mid', 'old'])
    expect(Array.prototype.toSorted).toBeUndefined()
  })

  it('does not mutate the input list', () => {
    // @ts-expect-error Hermes gap
    delete Array.prototype.toSorted
    const input = [
      { id: 'a', lastConnected: 1 },
      { id: 'b', lastConnected: 2 }
    ]
    const snapshot = [...input]
    sortByLastConnected(input)
    expect(input).toEqual(snapshot)
  })
})
