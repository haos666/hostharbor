import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { AppError } from '../shared/errors'
import type { BackupCounts, BackupPreview, BackupSelection, BackupImportResult } from '../shared/backup'

interface BackupCore { call<T>(method: string, payload?: unknown): Promise<T> }
interface BackupDialogs { save(): Promise<string | null>; open(): Promise<string | null> }
// Only native dialog results become paths. Renderer-supplied paths are never accepted.
export class DesktopBackup {
  private selected: { id: string; path: string; revision: number; expiresAt: number } | undefined
  constructor(private core: BackupCore, private revision: () => number, private dialogs: BackupDialogs) {}
  private async guard() {
    const revision = this.revision(), state = await this.core.call<{ vault: string }>('status')
    if (state.vault !== 'unlocked' || revision !== this.revision()) throw new AppError('VAULT_LOCKED')
    return () => { if (revision !== this.revision()) throw new AppError('VAULT_LOCKED') }
  }
  async choose() {
    const check = await this.guard(), revision = this.revision()
    this.selected = undefined
    await this.core.call('cancelBackup')
    const path = await this.dialogs.open(); check()
    if (!path) return null
    const id = randomUUID(); this.selected = { id, path, revision, expiresAt: Date.now() + 600000 }
    return { id, name: basename(path) }
  }
  async export(password: unknown): Promise<BackupCounts | null> {
    const check = await this.guard()
    if (typeof password !== 'string' || !password.length || password.length > 1048576) throw new AppError('BACKUP_PASSWORD')
    const path = await this.dialogs.save(); check()
    if (!path) return null
    const value = await this.core.call<BackupCounts>('exportBackup', { path, password }); check(); return value
  }
  async preview(raw: unknown): Promise<BackupPreview> {
    const check = await this.guard()
    if (!raw || typeof raw !== 'object') throw new AppError('INVALID_INPUT')
    const input = raw as { fileId?: unknown; password?: unknown }, file = this.selected
    if (!file || input.fileId !== file.id || file.revision !== this.revision() || file.expiresAt <= Date.now()) throw new AppError('BACKUP_SESSION')
    if (typeof input.password !== 'string' || input.password.length > 1048576) throw new AppError('BACKUP_PASSWORD')
    const value = await this.core.call<BackupPreview>('previewBackup', { path: file.path, password: input.password }); check(); return value
  }
  async commit(input: BackupSelection): Promise<BackupImportResult> { const check = await this.guard(); const result = await this.core.call<BackupImportResult>('commitBackup', input); this.selected = undefined; check(); return result }
  async cancel(): Promise<void> { this.selected = undefined; await this.core.call('cancelBackup') }
}
