import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import type { McpLockSettings } from '../../shared/contracts'
import type { ServerService } from '../servers/service'

const schema = z.object({ revision: z.number().int().nonnegative().safe(), pauseMcp: z.boolean() }).strict()
// This gate applies only to the parent desktop RPC. MCP retains its own mandatory
// vault/auth/policy checks and cannot invoke these methods.
export class DesktopSession {
  locked = true
  revision = 0
  private readonly path: string
  constructor(directory: string, private readonly servers: ServerService) { this.path = join(directory, 'mcp-lock-settings.json') }
  get backgroundMcp(): boolean { return this.locked && this.servers.vaultState === 'unlocked' }
  get vaultState() { return this.locked && this.servers.vaultState === 'unlocked' ? 'locked' as const : this.servers.vaultState }
  assertOpen(): void { if (this.locked) throw new AppError('VAULT_LOCKED'); this.servers.assertUnlocked() }
  assertRevision(revision: number): void { this.assertOpen(); if (revision !== this.revision) throw new AppError('VAULT_LOCKED') }
  get(): McpLockSettings {
    try {
      if (!existsSync(this.path)) return { revision: 0, pauseMcp: true }
      if (statSync(this.path).size > 4096) throw new Error('size')
      return schema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch { throw new AppError('STORAGE_FAILED') }
  }
  save(raw: unknown): McpLockSettings {
    this.assertOpen()
    const input = schema.extend({ confirmed: z.boolean().optional() }).strict().safeParse(raw)
    if (!input.success) throw new AppError('INVALID_INPUT')
    const current = this.get()
    if (input.data.revision !== current.revision) throw new AppError('MCP_LOCK_CONFLICT')
    if (!input.data.pauseMcp && !input.data.confirmed) throw new AppError('INVALID_INPUT')
    const next = { revision: current.revision + 1, pauseMcp: input.data.pauseMcp }
    const temporary = `${this.path}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600); writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); closeSync(fd); fd = undefined
      renameSync(temporary, this.path); return next
    } catch { throw new AppError('STORAGE_FAILED') }
    finally { if (fd !== undefined) closeSync(fd); if (existsSync(temporary)) unlinkSync(temporary) }
  }
  lock(force = false): void {
    this.locked = true; this.revision++
    try { if (force || this.get().pauseMcp) this.servers.lock() }
    catch (error) { this.servers.lock(); throw error }
  }
  unlock(key: Buffer, resume: boolean): void {
    if (resume && this.servers.vaultState === 'unlocked') this.servers.validateKey(key)
    else this.servers.unlock(key)
    this.locked = false; this.revision++
  }
}

export const desktopPublicMethods = new Set(['status', 'approvalSnapshot', 'validateKey', 'unlock', 'unlockDesktop', 'lock', 'lockDesktop', 'getMcpLockSettings'])
