import type { RuntimeOwnerEnvironment } from '../../../shared/runtime-environment-owner'

const EMPTY_ENVIRONMENTS: readonly RuntimeOwnerEnvironment[] = []
let readEnvironments: () => readonly RuntimeOwnerEnvironment[] = () => EMPTY_ENVIRONMENTS

export function registerRuntimeOwnerEnvironments(
  read: () => readonly RuntimeOwnerEnvironment[]
): void {
  readEnvironments = read
}

export function getRuntimeOwnerEnvironments(): readonly RuntimeOwnerEnvironment[] {
  return readEnvironments()
}
