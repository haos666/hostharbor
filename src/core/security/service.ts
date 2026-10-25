import { randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import { createEnvelope, secret, unwrap, wrap, type Role } from './envelope'
import { KeyFile } from './key-file'

interface Core { call<T = unknown>(method: string, payload?: unknown): Promise<T> }
const text = z.string().max(1048576)
const setup = z.object({ password: text, recovery: text }).strict()
const change = z.object({ currentPassword: text, newPassword: text }).strict()
const reset = z.object({ recovery: text, newPassword: text }).strict()
const recoveryChange = z.object({ currentPassword: text, currentRecovery: text, newRecovery: text }).strict()
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const result = schema.safeParse(raw); if (!result.success) throw new AppError('SECURITY_INPUT'); return result.data }

// Main injects the OS adapter and Core transport. No key is returned to renderer.
export class SecurityService {
  private epoch = 0
  private busy = false
  private failures = 0
  private retryAt = 0
  constructor(readonly keys: KeyFile, private readonly core: Core) {}
  get lockRevision(): number { return this.epoch }
  async lock(): Promise<void> { this.epoch++; await this.core.call('lock') }
  async lockDesktop(): Promise<void> { this.epoch++; await this.core.call('lockDesktop') }
  private async exclusive(job: (check: () => void) => Promise<void>): Promise<void> {
    if (this.busy) throw new AppError('SECURITY_BUSY')
    if (Date.now() < this.retryAt) throw new AppError('SECURITY_RETRY')
    this.busy = true
    const epoch = this.epoch
    const check = () => { if (epoch !== this.epoch) throw new AppError('VAULT_LOCKED') }
    try { await job(check); this.failures = 0; this.retryAt = 0 }
    catch (error) {
      if (error instanceof AppError && error.code === 'UNLOCK_FAILED') {
        this.failures++; this.retryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(this.failures - 1, 5))
      }
      // Any failed security operation closes access, including invalid input and write failure.
      await this.core.call('lock')
      throw error
    } finally { this.busy = false }
  }
  private async verify(key: Buffer, check: () => void): Promise<void> {
    check()
    await this.core.call('validateKey', key)
    check()
  }
  async setup(raw: unknown): Promise<void> {
    return this.exclusive(async (check) => {
      await this.core.call('lock')
      const input = parse(setup, raw)
      secret(input.password); secret(input.recovery)
      if (input.password === input.recovery) throw new AppError('SECURITY_INPUT')
      const mode = this.keys.mode
      if (mode === 'password') throw new AppError('VAULT_EXISTS')
      const key = mode === 'legacy' ? await this.keys.legacyKey() : randomBytes(32)
      try {
        await this.verify(key, check)
        const envelope = await createEnvelope(key, input.password, input.recovery)
        await this.keys.save(envelope, check)
      } finally { key.fill(0) }
    })
  }
  async unlock(raw: unknown, resumeDesktop = false): Promise<void> {
    return this.exclusive(async (check) => {
      if (!resumeDesktop) await this.core.call('lock')
      const password = secret(raw)
      const key = await unwrap(await this.keys.envelope(), password, 'password')
      try { check(); await this.core.call(resumeDesktop ? 'unlockDesktop' : 'unlock', key); check() }
      finally { key.fill(0) }
    })
  }
  async changePassword(raw: unknown): Promise<void> {
    return this.rewrap(raw, 'password')
  }
  async resetPassword(raw: unknown): Promise<void> {
    return this.rewrap(raw, 'recovery')
  }
  private async rewrap(raw: unknown, role: Role): Promise<void> {
    return this.exclusive(async (check) => {
      await this.core.call('lock')
      const input = role === 'password' ? parse(change, raw) : parse(reset, raw)
      const proof = 'currentPassword' in input ? input.currentPassword : input.recovery
      const newPassword = secret(input.newPassword)
      // When recovering, reject reusing the recovery code as the password.
      if (role === 'recovery' && proof === newPassword) throw new AppError('SECURITY_INPUT')
      const envelope = await this.keys.envelope()
      const key = await unwrap(envelope, proof, role)
      try {
        await this.verify(key, check)
        // Also prevents a known recovery code from being used as the new password.
        let recoveryKey: Buffer | undefined
        try { recoveryKey = await unwrap(envelope, newPassword, 'recovery') } catch (error) { if (!(error instanceof AppError) || error.code !== 'UNLOCK_FAILED') throw error }
        if (recoveryKey) { recoveryKey.fill(0); throw new AppError('SECURITY_INPUT') }
        await this.keys.save({ ...envelope, password: await wrap(key, newPassword, envelope.id, 'password') }, check)
      } finally { key.fill(0) }
    })
  }
  async changeRecovery(raw: unknown): Promise<void> {
    return this.exclusive(async (check) => {
      await this.core.call('lock')
      const input = parse(recoveryChange, raw)
      secret(input.newRecovery)
      if (input.currentPassword === input.newRecovery || input.currentRecovery === input.newRecovery) throw new AppError('SECURITY_INPUT')
      const envelope = await this.keys.envelope()
      const key = await unwrap(envelope, input.currentPassword, 'password')
      try {
        const recoveryKey = await unwrap(envelope, input.currentRecovery, 'recovery')
        try { if (!timingSafeEqual(key, recoveryKey)) throw new AppError('VAULT_CORRUPT') } finally { recoveryKey.fill(0) }
        await this.verify(key, check)
        await this.keys.save({ ...envelope, recovery: await wrap(key, input.newRecovery, envelope.id, 'recovery') }, check)
      } finally { key.fill(0) }
    })
  }
}
