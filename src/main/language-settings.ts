import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AppError } from '../shared/errors'
import { isLanguagePreference, type LanguagePreference } from '../shared/i18n'

export class LanguageSettingsStore {
  private readonly path: string
  constructor(directory: string) { this.path = join(directory, 'language-settings.json') }
  get(): LanguagePreference {
    try {
      if (!existsSync(this.path)) return 'system'
      if (statSync(this.path).size > 1024) throw new Error('size')
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !('locale' in value) || !isLanguagePreference(value.locale)) throw new Error('locale')
      return value.locale
    } catch { throw new AppError('STORAGE_FAILED') }
  }
  save(locale: unknown): LanguagePreference {
    if (!isLanguagePreference(locale)) throw new AppError('INVALID_INPUT')
    const temporary = `${this.path}.${randomUUID()}.tmp`
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      writeFileSync(descriptor, JSON.stringify({ locale })); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined
      renameSync(temporary, this.path)
      return locale
    } catch { throw new AppError('STORAGE_FAILED') }
    finally { if (descriptor !== undefined) closeSync(descriptor); if (existsSync(temporary)) unlinkSync(temporary) }
  }
}
