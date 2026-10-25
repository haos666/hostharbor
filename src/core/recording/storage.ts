import { gzipSync, gunzipSync } from 'node:zlib'
import { z } from 'zod'
import type { RecordingSettings, RecordingStorage } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { parse } from '../validation'
import type { ServerService } from '../servers/service'
export const finishedSql = "('succeeded','failed','denied','interrupted','unknown','expired')"
const settingsSchema = z.object({ revision: z.number().int().nonnegative().safe(), retentionDays: z.number().int().min(1).max(365), quotaMiB: z.number().int().min(64).max(4096) }).strict()
export class RecordingStore {
  private lastSweep = 0
  private maintenanceFailed = false
  private timer: ReturnType<typeof setInterval>
  constructor(private servers: ServerService, private activeCount: () => number) {
    this.timer = setInterval(() => { if (servers.vaultState === 'unlocked') { try { this.maintain() } catch { this.maintenanceFailed = true } } }, 60000)
    this.timer.unref()
  }
  private get db() { return this.servers.store.db }
  settings(): RecordingSettings {
    this.servers.assertUnlocked()
    const row = this.db.prepare('SELECT revision,detail FROM recording_settings WHERE id=1').get()
    if (!row) throw new AppError('STORAGE_FAILED')
    if (row.revision === 0 && row.detail === null) return { revision: 0, retentionDays: 7, quotaMiB: 500 }
    const data = this.servers.reveal('recording-settings:v1', row.detail as Uint8Array)
    try { const result = settingsSchema.parse(JSON.parse(data.toString())); if (result.revision !== row.revision) throw new Error(); return result }
    catch { throw new AppError('STORAGE_FAILED') } finally { data.fill(0) }
  }
  save(raw: unknown): RecordingStorage {
    const input = parse(settingsSchema, raw), old = this.settings()
    if (input.revision !== old.revision) throw new AppError('POLICY_CONFLICT')
    const next = { ...input, revision: input.revision + 1 }, data = Buffer.from(JSON.stringify(next))
    try { const result=this.db.prepare('UPDATE recording_settings SET revision=?,detail=? WHERE id=1 AND revision=?').run(next.revision, this.servers.protect('recording-settings:v1', data), old.revision); if(result.changes!==1)throw new AppError('POLICY_CONFLICT') }
    catch(error) { throw error instanceof AppError ? error : new AppError('STORAGE_FAILED') }
    finally { data.fill(0) }
    // Persist settings first; subsequent scheduled/explicit maintenance applies the new limits.
    return this.stats()
  }
  stats(): RecordingStorage {
    const settings = this.settings(), page = Number(this.db.prepare('PRAGMA page_size').get()!.page_size)
    const usage = this.db.prepare('SELECT COALESCE(SUM(length(data)),0) bytes,COUNT(DISTINCT operationId) count FROM operation_output').get()!
    return { settings, databaseBytes: page * Number(this.db.prepare('PRAGMA page_count').get()!.page_count), reusableBytes: page * Number(this.db.prepare('PRAGMA freelist_count').get()!.freelist_count), outputStoredBytes: Number(usage.bytes), outputCount: Number(usage.count), operationCount: Number(this.db.prepare('SELECT COUNT(*) count FROM operations').get()!.count), lastMaintenanceFailed: this.maintenanceFailed }
  }
  private clear(id: string, reason: string, now: number) {
    this.db.prepare('DELETE FROM operation_output WHERE operationId=?').run(id)
    this.db.prepare('UPDATE operations SET replayClearedAt=?,replayClearReason=? WHERE id=?').run(now, reason, id)
  }
  sweepIfDue(): void { if (Date.now() - this.lastSweep >= 60000) this.maintain() }
  maintain(reserveBytes = 0): void {
    const settings = this.settings(), now = Date.now(), limit = settings.quotaMiB * 1048576 - reserveBytes
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const old = this.db.prepare(`SELECT id FROM operations WHERE state IN ${finishedSql} AND replayClearedAt IS NULL AND updatedAt<=? AND EXISTS (SELECT 1 FROM operation_output WHERE operationId=operations.id)`).all(now - settings.retentionDays * 86400000)
      for (const row of old) this.clear(String(row.id), 'expired', now)
      let bytes = Number(this.db.prepare('SELECT COALESCE(SUM(length(data)),0) bytes FROM operation_output').get()!.bytes)
      if (bytes > limit) {
        const candidates = this.db.prepare(`SELECT o.id,SUM(length(p.data)) bytes FROM operations o JOIN operation_output p ON p.operationId=o.id WHERE o.state IN ${finishedSql} GROUP BY o.id ORDER BY o.updatedAt,o.id`).all()
        for (const row of candidates) { if (bytes <= limit) break; this.clear(String(row.id), 'quota', now); bytes -= Number(row.bytes) }
      }
      if (bytes > limit) throw new AppError('OPERATION_LIMIT')
      this.db.exec('COMMIT'); this.maintenanceFailed = false; this.lastSweep = now
    } catch (error) { this.db.exec('ROLLBACK'); this.maintenanceFailed = true; throw error instanceof AppError ? error : new AppError('STORAGE_FAILED') }
  }
  reserve(): void { this.maintain((this.activeCount() + 1) * 8 * 1048576) }
  clearOutput(id: string): void {
    this.servers.assertUnlocked()
    const row = this.db.prepare('SELECT state FROM operations WHERE id=?').get(id)
    if (!row) throw new AppError('NOT_FOUND')
    if (!['succeeded','failed','denied','interrupted','unknown','expired'].includes(String(row.state))) throw new AppError('STORAGE_BUSY')
    this.db.exec('BEGIN IMMEDIATE')
    try { this.clear(id, 'manual', Date.now()); this.db.exec('COMMIT') } catch { this.db.exec('ROLLBACK'); throw new AppError('STORAGE_FAILED') }
  }
  reclaim(): RecordingStorage {
    this.servers.assertUnlocked()
    if (this.activeCount() || this.db.prepare(`SELECT id FROM operations WHERE state NOT IN ${finishedSql} LIMIT 1`).get()) throw new AppError('STORAGE_BUSY')
    try { this.db.exec('VACUUM') } catch { throw new AppError('STORAGE_FAILED') }
    return this.stats()
  }
  encode(context: string, value: string): Buffer {
    const plain = Buffer.from(JSON.stringify(value)), compressed = gzipSync(plain)
    try { return this.servers.protect(context, compressed) } finally { plain.fill(0); compressed.fill(0) }
  }
  decode(context: string, data: Uint8Array, encoding: string): string {
    const secret = this.servers.reveal(context, data)
    let plain: Buffer | undefined
    try {
      if (encoding !== 'json' && encoding !== 'gzip-json') throw new Error()
      plain = encoding === 'gzip-json' ? gunzipSync(secret, { maxOutputLength: 65536 }) : secret
      const value: unknown = JSON.parse(plain.toString())
      if (typeof value !== 'string' || value.length > 16384) throw new Error()
      return value
    } catch { throw new AppError('STORAGE_FAILED') } finally { secret.fill(0); plain?.fill(0) }
  }
  close() { clearInterval(this.timer) }
}
