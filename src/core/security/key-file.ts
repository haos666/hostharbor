import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { AppError } from '../../shared/errors'
import { parseEnvelope, type Envelope } from './envelope'

export interface OsProtection { encrypt(value: string): Promise<Buffer>; decrypt(value: Buffer): Promise<string> }
const PREFIX = Buffer.from('HostHarbor password vault v2\n')
export class KeyFile {
  readonly path: string
  constructor(directory: string, private readonly os: OsProtection) { this.path = join(directory, 'protected-key.bin') }
  private read(): Buffer {
    try {
      if (statSync(this.path).size > 32768) throw new Error('Oversize')
      return readFileSync(this.path)
    } catch { throw new AppError('KEY_UNAVAILABLE') }
  }
  get mode(): 'not-configured' | 'legacy' | 'password' {
    if (!existsSync(this.path)) return 'not-configured'
    return this.read().subarray(0, PREFIX.length).equals(PREFIX) ? 'password' : 'legacy'
  }
  async legacyKey(): Promise<Buffer> {
    if (this.mode !== 'legacy') throw new AppError('SECURITY_REQUIRED')
    try {
      const value = await this.os.decrypt(this.read())
      const key = Buffer.from(value, 'base64')
      if (key.length !== 32 || key.toString('base64') !== value) { key.fill(0); throw new Error('Invalid') }
      return key
    } catch { throw new AppError('KEY_UNAVAILABLE') }
  }
  async envelope(): Promise<Envelope> {
    if (this.mode !== 'password') throw new AppError('SECURITY_REQUIRED')
    let value: string
    try { value = await this.os.decrypt(this.read().subarray(PREFIX.length)) }
    catch { throw new AppError('KEY_UNAVAILABLE') }
    return parseEnvelope(value)
  }
  async save(envelope: Envelope, beforeCommit: () => void): Promise<void> {
    const protectedValue = await this.os.encrypt(JSON.stringify(envelope))
    const temporary = `${this.path}.${randomBytes(12).toString('hex')}.tmp`
    try {
      writeFileSync(temporary, Buffer.concat([PREFIX, protectedValue]), { flag: 'wx', mode: 0o600, flush: true })
      beforeCommit()
      renameSync(temporary, this.path)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('STORAGE_FAILED')
    } finally { rmSync(temporary, { force: true }) }
  }
}
