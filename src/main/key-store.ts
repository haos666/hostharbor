import { safeStorage } from 'electron'
import { AppError } from '../shared/errors'
import { KeyFile } from '../core/security/key-file'

async function available(): Promise<void> {
  if (!['darwin', 'win32'].includes(process.platform) || !await safeStorage.isAsyncEncryptionAvailable()) throw new AppError('KEY_UNAVAILABLE')
}
export class KeyStore extends KeyFile {
  constructor(directory: string) {
    super(directory, {
      async encrypt(value) { await available(); return safeStorage.encryptStringAsync(value) },
      async decrypt(value) { await available(); return (await safeStorage.decryptStringAsync(value)).result },
    })
  }
}
