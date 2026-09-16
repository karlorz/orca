import { cleanCloudServiceOrigin } from '../../../shared/cloud-service-url'

export function resolvePushGatewayOrigin(
  env: NodeJS.ProcessEnv,
  packaged: boolean,
  overlay?: string
): string {
  return (
    cleanCloudServiceOrigin(env.ORCA_PUSH_GATEWAY_URL, !packaged) ??
    cleanCloudServiceOrigin(overlay, false) ??
    'https://push.onorca.dev'
  )
}
