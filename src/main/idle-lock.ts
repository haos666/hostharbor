import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AppStatus, IdleLockSettings } from '../shared/contracts'
import { AppError } from '../shared/errors'

const schema = z.object({ revision: z.number().int().nonnegative().safe(), seconds: z.union([z.literal(30), z.literal(1800), z.literal(null)]) }).strict()
export class IdleLockSettingsStore {
  private readonly path: string
  constructor(directory: string) { this.path = join(directory, 'idle-lock-settings.json') }
  get(): IdleLockSettings {
    try {
      if (!existsSync(this.path)) return { revision: 0, seconds: 1800 }
      if (statSync(this.path).size > 4096) throw new Error('size')
      return schema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch { throw new AppError('STORAGE_FAILED') }
  }
  save(raw: unknown): IdleLockSettings {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new AppError('INVALID_INPUT')
    const current = this.get()
    if (parsed.data.revision !== current.revision) throw new AppError('IDLE_LOCK_CONFLICT')
    const next = { ...parsed.data, revision: current.revision + 1 }, temporary = `${this.path}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); closeSync(fd); fd = undefined
      renameSync(temporary, this.path)
      return next
    } catch { throw new AppError('STORAGE_FAILED') }
    finally { if (fd !== undefined) closeSync(fd); if (existsSync(temporary)) unlinkSync(temporary) }
  }
}
interface Core { call<T = unknown>(method: string): Promise<T> }
// Main-owned controller with injected OS sampling and existing vault-lock path.
// MCP requests, output and renderer timers never count as user activity.
export class IdleLockService {
  readonly settings: IdleLockSettingsStore
  private timer?: ReturnType<typeof setInterval>
  private polling = false
  private stopped = false
  private epoch = 0
  private unlockedAt: number | null = null
  private lockRequired = false
  constructor(directory: string, private core: Core, private lockRevision: () => number, private idleSeconds: () => number, private lock: () => Promise<void>, private now: () => number = () => performance.now()) {
    this.settings = new IdleLockSettingsStore(directory)
  }
  get(): IdleLockSettings { return this.settings.get() }
  reset(): void { this.epoch++; this.unlockedAt = null }
  async save(raw: unknown): Promise<IdleLockSettings> {
    const epoch = this.epoch, revision = this.lockRevision()
    const state = await this.core.call<Pick<AppStatus, 'vault'>>('status')
    if (this.stopped || epoch !== this.epoch || revision !== this.lockRevision() || state.vault !== 'unlocked') throw new AppError('VAULT_LOCKED')
    const next = this.settings.save(raw); this.reset(); return next
  }
  start(): void {
    if (this.timer || this.stopped) return
    void this.poll(); this.timer = setInterval(() => void this.poll(), 1000)
  }
  private async enforceLock() { this.lockRequired = true; this.reset(); await this.lock(); this.lockRequired = false }
  async poll(): Promise<void> {
    if (this.polling || this.stopped) return
    this.polling = true
    const epoch = this.epoch, revision = this.lockRevision()
    const current = () => !this.stopped && epoch === this.epoch && revision === this.lockRevision()
    try {
      if (this.lockRequired) { await this.enforceLock(); return }
      const state = await this.core.call<Pick<AppStatus, 'vault'>>('status')
      if (!current()) return
      if (state.vault !== 'unlocked') { this.unlockedAt = null; return }
      const settings = this.settings.get(), now = this.now()
      this.unlockedAt ??= now
      if (settings.seconds === null) return
      const idle = this.idleSeconds()
      if (!Number.isFinite(idle) || idle < 0) throw new Error('Idle sampler unavailable')
      // A fresh unlock/setting change always receives a full interval, even if
      // the OS idle counter was already large (e.g. an external unlock flow).
      if (Math.min(idle * 1000, now - this.unlockedAt) >= settings.seconds * 1000) {
        await this.enforceLock()
      }
    } catch {
      // Corrupt preferences or unavailable sampling must not silently mean off.
      if (current()) { try { await this.enforceLock() } catch { /* Retry the required lock on the next poll. */ } }
    } finally { this.polling = false }
  }
  stop(): void { this.stopped = true; this.reset(); clearInterval(this.timer); this.timer = undefined }
}
