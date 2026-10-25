import type { Operation, OperationGuidance } from '../../shared/contracts'
import { approvalLifetimeMs, approvalPollIntervalMs, approvalWaitMs } from '../../shared/approval-timing'

// Derived at read time, never persisted as a new approval or execution decision.
export function operationGuidance(operation: Pick<Operation, 'id' | 'state' | 'createdAt' | 'intentAt'> & Pick<Partial<Operation>, 'transfer'>, now: number, profileExpiresAt: number | null): OperationGuidance {
  const base: OperationGuidance = {
    operationId: operation.id, serverTime: now, nextAction: 'stop', pollAfterMs: null,
    approvalWaitUntil: null, approvalExpiresAt: null,
    resume: { tool: 'get_operation', arguments: { id: operation.id } },
    automaticResubmitAllowed: false, message: '',
  }
  if (operation.state === 'awaiting_approval') {
    const expiresAt = Math.min(operation.createdAt + approvalLifetimeMs, profileExpiresAt ?? Infinity)
    const waitUntil = Math.min(operation.createdAt + approvalWaitMs, expiresAt)
    return { ...base, approvalWaitUntil: waitUntil, approvalExpiresAt: expiresAt,
      nextAction: now < waitUntil ? 'poll' : 'ask_user',
      pollAfterMs: now < waitUntil ? Math.min(approvalPollIntervalMs, waitUntil - now) : null,
      message: now < waitUntil
        ? '此操作需要人工审批，尚未执行。请立即告知用户前往 HostHarbor → 审批中心确认。按 pollAfterMs 查询原操作，最多等到 approvalWaitUntil；无法定时等待时直接交还用户，禁止连续轮询。'
        : '此操作仍在等待审批，尚未执行。请前往 HostHarbor → 审批中心处理；处理后回复“继续”，我会查询原操作的状态和结果。停止轮询并保留原操作 ID；不要重新提交或延长审批期限。' }
  }
  if (['queued', 'connecting', 'dispatching', 'running'].includes(operation.state)) return {
    ...base, nextAction: 'poll', pollAfterMs: 2000,
    message: operation.transfer ? '文件任务正在处理；按间隔查询同一操作ID的fileResult进度，不读取或传递二进制内容，不重复提交。' : '操作正在排队、连接或执行；查询同一操作 ID，完成后读取输出。不要重新提交；三分钟审批等待上限不代表命令执行超时。',
  }
  if (operation.transfer && (operation.state === 'succeeded' || operation.state === 'failed')) return { ...base, message: '文件任务已结束，读取当前fileResult中的目录条目、进度、校验和发布状态；不需要read_output，不自动重新传输。' }
  if (operation.transfer && (operation.state === 'unknown' || operation.intentAt !== null)) return { ...base, nextAction: 'inspect', message: '文件操作最终结果未确认。核对fileResult和临时文件线索，先检查目标文件，禁止自动重传或覆盖。' }
  if (operation.state === 'succeeded' || operation.state === 'failed') return {
    ...base, nextAction: 'read_output', message: '操作已结束，请读取原操作输出并结合退出结果分析；不要自动重新执行。',
  }
  if (operation.state === 'unknown' || operation.intentAt !== null) return {
    ...base, nextAction: 'inspect', message: '执行结果或远端进程状态未确认。查看原操作记录并告知用户，不能根据断开连接推断远端已停止，禁止自动重试。',
  }
  return { ...base, message: operation.state === 'expired'
    ? '审批或授权已过期，原操作未执行。停止等待；用户回复“继续”仅表示查询原记录，重新发起需要用户重新明确确认，不能自动生成新请求。'
    : operation.state === 'denied'
      ? '操作已被拒绝或取消，未派发执行。停止等待并告知用户，不要更换请求标识重新提交。'
      : '操作已中止，尚未派发执行。停止等待，说明当前状态；不要自动重新提交。' }
}
