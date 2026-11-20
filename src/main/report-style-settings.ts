import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AppError } from '../shared/errors'
import { isReportBackground, type ReportBackground } from '../shared/report-style'

export class ReportStyleSettingsStore {
  private readonly path: string
  constructor(directory: string) { this.path = join(directory, 'report-style-settings.json') }
  get(): ReportBackground {
    try {
      if (!existsSync(this.path)) return 'default'
      if (statSync(this.path).size > 1024) throw new Error('size')
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !('background' in value) || !isReportBackground(value.background)) throw new Error('background')
      return value.background
    } catch { throw new AppError('STORAGE_FAILED') }
  }
  save(background: unknown): ReportBackground {
    if (!isReportBackground(background)) throw new AppError('INVALID_INPUT')
    const temporary = `${this.path}.${randomUUID()}.tmp`
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      writeFileSync(descriptor, JSON.stringify({ background })); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined
      renameSync(temporary, this.path)
      return background
    } catch { throw new AppError('STORAGE_FAILED') }
    finally { if (descriptor !== undefined) closeSync(descriptor); if (existsSync(temporary)) unlinkSync(temporary) }
  }
}
