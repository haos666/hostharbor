import type { CredentialSummary, ServerRecord } from '../../shared/contracts'
import { msg } from '../../shared/i18n'

export const credentialTypes = [
  { kind: 'password' as const, get label() { return msg('credentialsPage.password') } },
  { kind: 'private-key' as const, label: 'SSH Key' },
]
export const credentialLabel = (kind: CredentialSummary['kind']) => credentialTypes.find((type) => type.kind === kind)!.label

export function credentialUsage(servers: ServerRecord[], id: string): number {
  return servers.filter((server) => server.credentialId === id || (server.route.type === 'socks5' && server.route.authentication.type === 'password' && server.route.authentication.credentialId === id)).length
}
