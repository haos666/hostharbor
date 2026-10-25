import { AppError } from '../../shared/errors'
// Progress extends only the stall deadline, never total duration or authorization.
export class TransferDeadline {
  private total: ReturnType<typeof setTimeout>
  private idle: ReturnType<typeof setTimeout>
  private stopped = false
  constructor(totalMs: number, private readonly idleMs: number, private readonly fail: (error: AppError) => void) {
    this.total = setTimeout(() => this.expire('FILE_TOTAL_TIMEOUT'), totalMs)
    this.idle = setTimeout(() => this.expire('FILE_IDLE_TIMEOUT'), idleMs)
  }
  private expire(code: 'FILE_IDLE_TIMEOUT' | 'FILE_TOTAL_TIMEOUT') { if (!this.stopped) { this.close(); this.fail(new AppError(code)) } }
  progress() { if (!this.stopped) { clearTimeout(this.idle); this.idle = setTimeout(() => this.expire('FILE_IDLE_TIMEOUT'), this.idleMs) } }
  close() { this.stopped = true; clearTimeout(this.total); clearTimeout(this.idle) }
}
