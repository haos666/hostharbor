import { describe, expect, it } from 'vitest'
import { operationGuidance } from '../src/core/operations/guidance'
import { approvalWaitInstructions } from '../src/shared/mcp-instructions'
import { mcpToolDefinitions } from '../src/shared/mcp-tools'
import type { OperationState } from '../src/shared/contracts'
const submittedAt = 1800000000000
const operation = { id: 'synthetic-operation', createdAt: submittedAt, state: 'awaiting_approval' as OperationState, intentAt: null as number | null }
describe('approval waiting and continuation guidance', () => {
  it('uses the exact three minute boundary without changing the five minute expiry or original ID', () => {
    for (const elapsed of [0, 179999, 180000, 240000]) {
      const guidance = operationGuidance(operation, submittedAt + elapsed, null)
      expect(guidance.approvalWaitUntil).toBe(submittedAt + 180000)
      expect(guidance.approvalExpiresAt).toBe(submittedAt + 300000)
      expect(guidance.resume).toEqual({ tool: 'get_operation', arguments: { id: operation.id } })
      expect(guidance.nextAction).toBe(elapsed < 180000 ? 'poll' : 'ask_user')
      expect(guidance.pollAfterMs).toBe(elapsed < 180000 ? Math.min(10000, 180000 - elapsed) : null)
      expect(guidance.automaticResubmitAllowed).toBe(false)
    }
  })
  it('clamps wait/approval deadlines to a shorter actual access grant', () => {
    const grantExpiry = submittedAt + 60000
    const guidance = operationGuidance(operation, submittedAt, grantExpiry)
    expect(guidance.approvalWaitUntil).toBe(grantExpiry)
    expect(guidance.approvalExpiresAt).toBe(grantExpiry)
  })
  it.each(['queued', 'connecting', 'dispatching', 'running'] as const)('does not apply the approval wait budget to %s', state => {
    expect(operationGuidance({ ...operation, state, intentAt: submittedAt }, submittedAt + 400000, null)).toMatchObject({ nextAction: 'poll', pollAfterMs: 2000, approvalWaitUntil: null, approvalExpiresAt: null })
  })
  it.each(['succeeded', 'failed'] as const)('directs %s to recorded output, without authorizing another execution', state => {
    expect(operationGuidance({ ...operation, state, intentAt: submittedAt }, submittedAt + 180000, null)).toMatchObject({ nextAction: 'read_output', pollAfterMs: null, automaticResubmitAllowed: false })
  })
  it.each(['denied', 'expired', 'interrupted'] as const)('stops on never-dispatched %s', state => {
    expect(operationGuidance({ ...operation, state }, submittedAt + 300000, null)).toMatchObject({ nextAction: 'stop', pollAfterMs: null })
  })
  it.each([{ state: 'unknown', intentAt: null }, { state: 'unknown', intentAt: submittedAt }, { state: 'interrupted', intentAt: submittedAt }] as const)('preserves uncertainty for %o', input => {
    const guidance = operationGuidance({ ...operation, ...input }, submittedAt + 180000, null)
    expect(guidance.nextAction).toBe('inspect'); expect(guidance.message).not.toContain('原操作未执行')
    expect(guidance.automaticResubmitAllowed).toBe(false)
  })
  it('publishes the same wait/resume contract in each relevant tool and the global instructions', () => {
    for (const name of ['start_command', 'query_application_logs', 'get_operation', 'read_output'] as const) expect(mcpToolDefinitions[name].description).toContain('at most 3 minutes')
    expect(approvalWaitInstructions).toContain('停止 get_operation/read_output')
    expect(approvalWaitInstructions).toContain('仍待审批则再次提醒后停止')
    expect(approvalWaitInstructions).toContain('VAULT_LOCKED')
  })
})
