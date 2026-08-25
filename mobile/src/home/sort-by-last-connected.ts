export function sortByLastConnected<T extends { lastConnected: number }>(items: readonly T[]): T[] {
  // Why: RN 0.83 Hermes has no Array.prototype.toSorted; using it crashes Home on launch.
  return [...items].sort((left, right) => right.lastConnected - left.lastConnected)
}
