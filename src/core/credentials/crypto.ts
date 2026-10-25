import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { AppError } from '../../shared/errors'

export function seal(key: Buffer, context: string, plaintext: Buffer): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(`hostharbor:v1:${context}`))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext])
}
export function open(key: Buffer, context: string, sealed: Uint8Array): Buffer {
  try {
    const bytes = Buffer.from(sealed)
    if (bytes.length < 29 || bytes[0] !== 1) throw new Error('Invalid envelope')
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13))
    decipher.setAAD(Buffer.from(`hostharbor:v1:${context}`))
    decipher.setAuthTag(bytes.subarray(13, 29))
    return Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()])
  } catch { throw new AppError('VAULT_CORRUPT') }
}
