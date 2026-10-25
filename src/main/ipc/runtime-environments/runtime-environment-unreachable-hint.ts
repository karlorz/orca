/** What to suggest when a server cannot be reached, chosen by the kind of host that owns it. */
import { classifyRemotePairingHostname } from '../../../shared/remote-pairing-address'
import { withRemoteRuntimeTailscaleHint } from '../../../shared/remote-runtime/remote-runtime-tailscale-hint'
import { classifyRuntimeEnvironmentHost } from '../../../shared/runtime-environment-host-kind'
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'

const UNREACHABLE_RE =
  /could not connect to the remote orca runtime|remote orca runtime closed the connection|timed out (?:waiting for|while connecting to) the remote orca runtime/i

export const SSH_TUNNEL_UNREACHABLE_HINT =
  'This server is reached through an SSH tunnel from this app. Reconnect the SSH host in Settings after a restart, or pair using the other host’s LAN or Tailscale address.'

function pairingEndpointKind(endpoint: string | null | undefined): string | null {
  if (!endpoint) {
    return null
  }
  try {
    return classifyRemotePairingHostname(new URL(endpoint).hostname)
  } catch {
    return classifyRemotePairingHostname(endpoint)
  }
}

function usesSshTunnel(
  environment: Pick<KnownRuntimeEnvironment, 'orcadDeployment' | 'connectionDependency'>,
  endpoint: string | null | undefined
): boolean {
  const deployment = environment.orcadDeployment
  if (deployment && deployment.kind !== 'wsl') {
    return true
  }
  return (
    environment.connectionDependency === 'ssh-tunnel' ||
    pairingEndpointKind(endpoint) === 'loopback'
  )
}

export function withRuntimeUnreachableHint(
  environment: Pick<KnownRuntimeEnvironment, 'orcadDeployment' | 'connectionDependency'>,
  message: string,
  endpoint: string | null | undefined
): string {
  const host = classifyRuntimeEnvironmentHost(environment)
  switch (host.kind) {
    case 'network':
      return UNREACHABLE_RE.test(message) && usesSshTunnel(environment, endpoint)
        ? `${message} ${SSH_TUNNEL_UNREACHABLE_HINT}`
        : withRemoteRuntimeTailscaleHint(message, endpoint)
    case 'wsl':
      // WSL is reached locally through wsl.exe; a Tailscale hint cannot help.
      return UNREACHABLE_RE.test(message)
        ? `${message} The Orca server in the WSL distro ${host.deployment.distro} isn’t answering; connect it again in Settings → Remote Orca Servers → WSL hosts.`
        : message
  }
}
