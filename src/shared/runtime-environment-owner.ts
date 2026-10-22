export type RuntimeOwnerEnvironment = {
  id: string
  runtimeId?: string | null
  lastUsedAt?: number | null
}

export type RuntimeOwnerStatus = {
  snapshot?: { transport: string; verification: string; retired?: boolean }
}

export function canonicalRuntimeOwnerKey(
  environmentId: string | null | undefined,
  environments: readonly RuntimeOwnerEnvironment[]
): string | null {
  const id = environmentId?.trim()
  if (!id) {
    return null
  }
  return environments.find((environment) => environment.id === id)?.runtimeId?.trim() || id
}

export function sameCanonicalRuntimeOwner(
  left: string | null | undefined,
  right: string | null | undefined,
  environments: readonly RuntimeOwnerEnvironment[]
): boolean {
  return (
    canonicalRuntimeOwnerKey(left, environments) === canonicalRuntimeOwnerKey(right, environments)
  )
}

/** Whether the id names an environment this client is still paired to (blank or removed → false). */
export function isSavedRuntimeEnvironment(
  environments: readonly RuntimeOwnerEnvironment[],
  environmentId: string | null | undefined
): boolean {
  const id = environmentId?.trim()
  return !!id && environments.some((environment) => environment.id === id)
}

export function preferredRuntimeOwnerEnvironmentIds(
  environments: readonly RuntimeOwnerEnvironment[],
  statuses?: ReadonlyMap<string, RuntimeOwnerStatus>
): ReadonlyMap<string, string> {
  const preferred = new Map<string, RuntimeOwnerEnvironment>()
  const connected = (id: string) => {
    const snapshot = statuses?.get(id)?.snapshot
    return (
      snapshot?.transport === 'ready' && snapshot.verification === 'verified' && !snapshot.retired
    )
  }
  for (const environment of environments) {
    const key = canonicalRuntimeOwnerKey(environment.id, environments)
    if (!key) {
      continue
    }
    const current = preferred.get(key)
    if (
      !current ||
      (connected(environment.id) && !connected(current.id)) ||
      (connected(environment.id) === connected(current.id) &&
        (environment.lastUsedAt ?? 0) > (current.lastUsedAt ?? 0))
    ) {
      preferred.set(key, environment)
    }
  }
  return new Map(
    environments.map((environment) => [
      environment.id,
      preferred.get(canonicalRuntimeOwnerKey(environment.id, environments) ?? environment.id)?.id ??
        environment.id
    ])
  )
}
