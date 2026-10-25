import { expect, it } from 'vitest'
import { operationApproval } from '../src/shared/operation-approval'
import type { Operation, PolicyDecision } from '../src/shared/contracts'
const decision = (action: PolicyDecision['action']): PolicyDecision => ({ revision: 1, mode: 'assisted', action, reason: 'synthetic', matchedRules: [] })
it.each([
  [{ state: 'succeeded', decision: decision('allow') }, '自动通过'],
  [{ state: 'failed', decision: decision('allow') }, '自动通过'],
  [{ state: 'unknown', decision: decision('allow') }, '自动通过'],
  [{ state: 'unknown', decision: decision('approval'), humanDecision: 'approved' }, '人工批准'],
  [{ state: 'denied', decision: decision('approval'), humanDecision: 'denied' }, '人工拒绝'],
  [{ state: 'denied', decision: decision('deny') }, '策略拒绝'],
  [{ state: 'awaiting_approval', decision: { ...decision('approval'), aiReview: { status: 'complete', recommendation: 'query', risks: [], reason: 'synthetic' } } }, '待审批'],
  [{ state: 'expired', decision: decision('approval') }, '未批准'],
  [{ state: 'interrupted', decision: decision('approval') }, '未批准'],
  [{ state: 'succeeded' }, '未记录'],
] as const)('distinguishes approval from execution: %s', (operation, label) => {
  expect(operationApproval(operation as Pick<Operation, 'humanDecision' | 'state' | 'decision'>).label).toBe(label)
})
