import { randomBytes, scrypt } from 'node:crypto'
import { AppError } from '../../shared/errors'
import { open, seal } from '../credentials/crypto'

// Fixed, versioned KDF profile: no attacker-controlled CPU or memory parameters.
const magic = Buffer.from('HHBACKUP\x01', 'binary')
export const maxBackupBytes = 32 * 1024 * 1024
const headerLength = magic.length + 16
function passwordInput(password: unknown): asserts password is string {
  if (typeof password !== 'string' || !password.length || Buffer.byteLength(password) > 1048576) throw new AppError('BACKUP_PASSWORD')
}
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(new AppError('KEY_UNAVAILABLE')) : resolve(key)))
}
export async function encryptBackup(plain: Buffer, password: unknown): Promise<Buffer> {
  passwordInput(password)
  if (plain.length > maxBackupBytes - headerLength - 29) throw new AppError('BACKUP_LIMIT')
  const salt = randomBytes(16), key = await derive(password, salt)
  try { return Buffer.concat([magic, salt, seal(key, `backup:v1:${salt.toString('hex')}`, plain)]) } finally { key.fill(0) }
}
export async function decryptBackup(bytes: Buffer, password: unknown): Promise<Buffer> {
  passwordInput(password)
  if (bytes.length > maxBackupBytes) throw new AppError('BACKUP_LIMIT')
  if (bytes.length < headerLength + 29 || !bytes.subarray(0, magic.length).equals(magic)) throw new AppError('BACKUP_INVALID')
  const salt = bytes.subarray(magic.length, headerLength), key = await derive(password, salt)
  try { return open(key, `backup:v1:${salt.toString('hex')}`, bytes.subarray(headerLength)) }
  catch { throw new AppError('BACKUP_INVALID') }
  finally { key.fill(0) }
}
