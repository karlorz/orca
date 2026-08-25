export function sortByLastConnected<T extends { lastConnected: number }>(items: readonly T[]): T[] {
  // Why: RN 0.83 Hermes has no Array.prototype.toSorted; using it crashes Home on launch.
  if (items.length <= 1) {
    return items.slice()
  }
  return items.slice().sort((left, right) => right.lastConnected - left.lastConnected)
}
