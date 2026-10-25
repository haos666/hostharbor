import type { Operation } from './contracts'
// Approval and execution outcome are independent, including unknown outcomes.
export function operationApproval(operation: Pick<Operation, 'humanDecision' | 'decision' | 'state'>): { label: string; automatic: boolean } {
  if (operation.humanDecision === 'approved') return { label: '人工批准', automatic: false }
  if (operation.humanDecision === 'denied') return { label: '人工拒绝', automatic: false }
  if (operation.decision?.action === 'allow') return { label: '自动通过', automatic: true }
  if (operation.decision?.action === 'deny') return { label: '策略拒绝', automatic: false }
  if (operation.state === 'awaiting_approval') return { label: '待审批', automatic: false }
  return { label: operation.decision?.action === 'approval' ? '未批准' : '未记录', automatic: false }
}
