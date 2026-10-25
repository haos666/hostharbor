import { randomBytes, scrypt } from 'node:crypto'
import { z } from 'zod'
import { open, seal } from '../credentials/crypto'
import { AppError } from '../../shared/errors'

const slot = z.object({ salt: z.string().regex(/^[a-f0-9]{32}$/), wrapped: z.string().regex(/^[a-f0-9]{122}$/) }).strict()
export const envelopeSchema = z.object({ version: z.literal(2), id: z.string().regex(/^[a-f0-9]{32}$/), password: slot, recovery: slot }).strict()
export type Envelope = z.infer<typeof envelopeSchema>
export type Role = 'password' | 'recovery'
export function secret(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1048576) throw new AppError('SECURITY_INPUT')
  return value
}
export function parseEnvelope(raw: string): Envelope {
  try { return envelopeSchema.parse(JSON.parse(raw)) } catch { throw new AppError('VAULT_CORRUPT') }
}
async function derive(value: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(value, Buffer.from(salt, 'hex'), 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(new AppError('KEY_UNAVAILABLE')) : resolve(key)))
}
export async function wrap(key: Buffer, value: string, id: string, role: Role): Promise<Envelope[Role]> {
  if (key.length !== 32) throw new AppError('KEY_UNAVAILABLE')
  const salt = randomBytes(16).toString('hex')
  const derived = await derive(value, salt)
  try { return { salt, wrapped: seal(derived, `master:${id}:${role}`, key).toString('hex') } } finally { derived.fill(0) }
}
export async function unwrap(envelope: Envelope, value: string, role: Role): Promise<Buffer> {
  secret(value)
  const derived = await derive(value, envelope[role].salt)
  try { return open(derived, `master:${envelope.id}:${role}`, Buffer.from(envelope[role].wrapped, 'hex')) }
  catch { throw new AppError('UNLOCK_FAILED') }
  finally { derived.fill(0) }
}
export async function createEnvelope(key: Buffer, password: string, recovery: string): Promise<Envelope> {
  secret(password); secret(recovery)
  if (password === recovery) throw new AppError('SECURITY_INPUT')
  const id = randomBytes(16).toString('hex')
  return { version: 2, id, password: await wrap(key, password, id, 'password'), recovery: await wrap(key, recovery, id, 'recovery') }
}
