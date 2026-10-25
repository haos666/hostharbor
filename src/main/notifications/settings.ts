import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { NotificationPreferences } from '../../shared/contracts'
import { AppError } from '../../shared/errors'

const schema = z.object({ revision: z.number().int().nonnegative().safe(), badge: z.boolean(), system: z.boolean(), sound: z.boolean() }).strict()
export const defaultNotificationPreferences: NotificationPreferences = { revision: 0, badge: true, system: true, sound: false }
// Desktop preferences contain no assets or secrets and remain available when locked.
export class NotificationSettingsStore {
  private readonly path: string
  constructor(directory: string) { this.path = join(directory, 'notification-settings.json') }
  get(): NotificationPreferences {
    try {
      if (!existsSync(this.path)) return { ...defaultNotificationPreferences }
      if (statSync(this.path).size > 4096) throw new Error('size')
      return schema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch { throw new AppError('STORAGE_FAILED') }
  }
  save(raw: unknown): NotificationPreferences {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new AppError('INVALID_INPUT')
    const old = this.get()
    if (old.revision !== parsed.data.revision) throw new AppError('NOTIFICATION_CONFLICT')
    const next = { ...parsed.data, revision: old.revision + 1 }, temporary = `${this.path}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); closeSync(fd); fd = undefined
      renameSync(temporary, this.path)
      return next
    } catch { throw new AppError('STORAGE_FAILED') }
    finally { if (fd !== undefined) closeSync(fd); if (existsSync(temporary)) unlinkSync(temporary) }
  }
}
