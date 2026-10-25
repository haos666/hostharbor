import { utilityProcess } from 'electron'
import { join } from 'node:path'
import { AppError, type Result } from '../shared/errors'

export class CoreClient {
  private worker: Electron.UtilityProcess
  private sequence = 0
  private pending = new Map<number, { resolve: (value: Result<unknown>) => void; timer: NodeJS.Timeout }>()
  private ready: Promise<void>
  state: 'starting' | 'ready' | 'unavailable' = 'starting'
  constructor(directory: string, entry = join(__dirname, 'core.cjs'), mcpPort?: number) {
    if (mcpPort !== undefined && (!Number.isInteger(mcpPort) || mcpPort < 0 || mcpPort > 65535)) throw new AppError('INVALID_INPUT')
    this.worker = utilityProcess.fork(entry, [directory, ...(mcpPort === undefined ? [] : [String(mcpPort)])], { serviceName: 'HostHarbor Core' })
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new AppError('CORE_UNAVAILABLE')), 10000)
      this.worker.on('message', (message: { type?: string; id?: number; result?: Result<unknown> }) => {
        if (message.type === 'core-ready') { clearTimeout(timer); this.state = 'ready'; resolve() }
        if (message.type === 'result' && typeof message.id === 'number') {
          const pending = this.pending.get(message.id)
          if (pending && message.result) { clearTimeout(pending.timer); this.pending.delete(message.id); pending.resolve(message.result) }
        }
      })
      this.worker.on('exit', () => {
        clearTimeout(timer)
        this.state = 'unavailable'
        reject(new AppError('CORE_UNAVAILABLE'))
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer)
          pending.resolve({ ok: false, error: { code: 'CORE_UNAVAILABLE', message: '执行内核不可用。' } })
        }
        this.pending.clear()
      })
    })
    void this.ready.catch(() => {})
  }
  async call<T>(method: string, payload?: unknown): Promise<T> {
    await this.ready
    if (this.state !== 'ready') throw new AppError('CORE_UNAVAILABLE')
    const id = ++this.sequence
    const result = await new Promise<Result<unknown>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: { code: 'CORE_UNAVAILABLE', message: '执行内核没有及时响应。' } })
      }, method === 'testAiTools' ? 130000 : 20000)
      this.pending.set(id, { resolve, timer })
      try { this.worker.postMessage({ id, method, payload }) } catch {
        clearTimeout(timer); this.pending.delete(id)
        resolve({ ok: false, error: { code: 'CORE_UNAVAILABLE', message: '执行内核不可用。' } })
      }
    })
    if (!result.ok) throw new AppError(result.error.code)
    return result.value as T
  }
  stop(): void { this.worker.kill() }
  async stopAndWait(): Promise<void> {
    if (this.state === 'unavailable') return
    await new Promise<void>((resolve) => { this.worker.once('exit', () => resolve()); this.worker.kill() })
  }
}
