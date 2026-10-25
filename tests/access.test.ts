import { describe, expect, it } from 'vitest'
import { authorize } from '../src/core/access/authorize'
import type { ClientGrant } from '../src/shared/contracts'

const now = 1000
const grant: ClientGrant = { id: 'g1', profileId: 'client-a', serverIds: ['server-a'], mode: 'time-limited', expiresAt: 2000 }
const request = { vaultUnlocked: true, authenticatedProfileId: 'client-a', serverId: 'server-a', now, grant }

describe('authorization boundary', () => {
  it('rejects access while locked, even with a valid grant', () => {
    expect(authorize({ ...request, vaultUnlocked: false })).toEqual({ outcome: 'deny', reason: 'locked' })
  })
  it('rejects a grant belonging to another authenticated client', () => {
    expect(authorize({ ...request, authenticatedProfileId: 'client-b' })).toEqual({ outcome: 'deny', reason: 'wrong-client' })
  })
  it('rejects another server even with a valid client identity', () => {
    expect(authorize({ ...request, serverId: 'server-b' })).toEqual({ outcome: 'deny', reason: 'server-not-granted' })
  })
  it('rejects missing, expired and revoked grants', () => {
    expect(authorize({ ...request, grant: undefined }).outcome).toBe('deny')
    expect(authorize({ ...request, now: 2000 })).toEqual({ outcome: 'deny', reason: 'expired' })
    expect(authorize({ ...request, grant: { ...grant, revokedAt: 0 } })).toEqual({ outcome: 'deny', reason: 'revoked' })
  })
  it('requires approval in confirm-each mode', () => {
    expect(authorize({ ...request, grant: { ...grant, mode: 'confirm-each' } })).toEqual({ outcome: 'approval-required', grantId: 'g1' })
  })
  it('allows an unexpired time-limited grant only within its scope', () => {
    expect(authorize(request)).toEqual({ outcome: 'allow', grantId: 'g1' })
  })
})
