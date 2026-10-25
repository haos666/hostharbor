import type { AuthorizationDecision, ClientGrant } from '../../shared/contracts'

/** Checks a selected grant. Approval binding and execution-time rechecks belong to operations. */
export function authorize(input: {
  vaultUnlocked: boolean
  authenticatedProfileId: string
  serverId: string
  now: number
  grant?: ClientGrant
}): AuthorizationDecision {
  if (!input.vaultUnlocked) return { outcome: 'deny', reason: 'locked' }
  const grant = input.grant
  if (!grant) return { outcome: 'deny', reason: 'no-grant' }
  if (grant.profileId !== input.authenticatedProfileId) return { outcome: 'deny', reason: 'wrong-client' }
  if (grant.revokedAt !== undefined) return { outcome: 'deny', reason: 'revoked' }
  if (grant.expiresAt <= input.now) return { outcome: 'deny', reason: 'expired' }
  if (!grant.serverIds.includes(input.serverId)) return { outcome: 'deny', reason: 'server-not-granted' }
  return {
    outcome: grant.mode === 'confirm-each' ? 'approval-required' : 'allow',
    grantId: grant.id,
  }
}
