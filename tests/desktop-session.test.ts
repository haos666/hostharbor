import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { DesktopSession } from '../src/core/security/desktop-session'
import { ServerService } from '../src/core/servers/service'
import { Store } from '../src/core/storage/database'
import { KeyFile } from '../src/core/security/key-file'
import { SecurityService } from '../src/core/security/service'

const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0)) close() })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'hostharbor-desktop-lock-'))
  const servers = new ServerService(new Store(join(directory, 'vault.sqlite')))
  const desktop = new DesktopSession(directory, servers), key = randomBytes(32)
  cleanup.push(() => { servers.close(); key.fill(0); rmSync(directory, { recursive: true, force: true }) })
  return { directory, servers, desktop, key }
}
describe('desktop session and background MCP preference', () => {
  it('defaults to true lock; opt-out does not open a startup vault', () => {
    const f = fixture()
    expect(f.desktop.get()).toEqual({ revision: 0, pauseMcp: true })
    expect(() => f.desktop.assertOpen()).toThrow(expect.objectContaining({ code: 'VAULT_LOCKED' }))
    writeFileSync(join(f.directory, 'mcp-lock-settings.json'), JSON.stringify({ revision: 1, pauseMcp: false }))
    f.desktop.lock()
    expect(f.desktop.backgroundMcp).toBe(false)
    expect(() => f.servers.assertUnlocked()).toThrow()
    f.desktop.unlock(f.key, true); f.desktop.lock()
    expect(f.desktop.vaultState).toBe('locked'); expect(f.desktop.backgroundMcp).toBe(true)
    expect(() => f.desktop.assertOpen()).toThrow()
    f.servers.assertUnlocked()
  })
  it('requires unlocked desktop, confirmation, strict schema and current revision', () => {
    const f = fixture()
    expect(() => f.desktop.save({ revision: 0, pauseMcp: false, confirmed: true })).toThrow()
    f.desktop.unlock(f.key, false)
    for (const input of [{ revision: 0, pauseMcp: false }, { revision: 0, pauseMcp: false, confirmed: false }, { revision: 0, pauseMcp: true, extra: true }]) expect(() => f.desktop.save(input)).toThrow()
    expect(f.desktop.save({ revision: 0, pauseMcp: false, confirmed: true })).toEqual({ revision: 1, pauseMcp: false })
    expect(new DesktopSession(f.directory, f.servers).get()).toEqual({ revision: 1, pauseMcp: false })
    expect(() => f.desktop.save({ revision: 0, pauseMcp: true })).toThrow(expect.objectContaining({ code: 'MCP_LOCK_CONFLICT' }))
    f.desktop.save({ revision: 1, pauseMcp: true }); f.desktop.lock()
    expect(f.desktop.backgroundMcp).toBe(false); expect(f.servers.vaultState).toBe('locked')
  })
  it.each(['{}', 'null', '{', JSON.stringify({ revision: 1, pauseMcp: 'false' })])('corrupt preferences force real lock: %s', value => {
    const f = fixture(); f.desktop.unlock(f.key, false)
    writeFileSync(join(f.directory, 'mcp-lock-settings.json'), value)
    expect(() => f.desktop.lock()).toThrow(expect.objectContaining({ code: 'STORAGE_FAILED' }))
    expect(f.desktop.locked).toBe(true); expect(f.servers.vaultState).toBe('locked')
  })
  it('discards results from before a lock, including after a quick unlock', () => {
    const f = fixture(); f.desktop.unlock(f.key, false)
    const revision = f.desktop.revision
    f.desktop.assertRevision(revision)
    f.desktop.save({ revision: 0, pauseMcp: false, confirmed: true }); f.desktop.lock()
    expect(() => f.desktop.assertRevision(revision)).toThrow()
    f.desktop.unlock(f.key, true)
    expect(() => f.desktop.assertRevision(revision)).toThrow()
    f.desktop.assertRevision(f.desktop.revision)
  })
  it('password resume preserves backend activity; security failure and changes still true-lock', async () => {
    const f = fixture()
    const keys = new KeyFile(f.directory, { async encrypt(value) { return Buffer.from(value) }, async decrypt(value) { return value.toString() } })
    const transport = { async call<T>(method: string, payload?: unknown): Promise<T> {
      if (method === 'lock') f.desktop.lock(true)
      else if (method === 'lockDesktop') f.desktop.lock()
      else if (method === 'validateKey') f.servers.validateKey(payload as Buffer)
      else if (method === 'unlock' || method === 'unlockDesktop') f.desktop.unlock(payload as Buffer, method === 'unlockDesktop')
      else throw new Error('Unexpected method')
      return undefined as T
    } }
    const security = new SecurityService(keys, transport)
    await security.setup({ password: 'synthetic', recovery: 'synthetic recovery' })
    await security.unlock('synthetic', true)
    f.desktop.save({ revision: 0, pauseMcp: false, confirmed: true })
    const invalidated = vi.fn(); f.servers.invalidated.add(invalidated)
    await security.lockDesktop(); expect(invalidated).not.toHaveBeenCalled()
    expect(() => f.desktop.save({ revision: 1, pauseMcp: true })).toThrow()
    await security.unlock('synthetic', true); expect(invalidated).not.toHaveBeenCalled()
    await security.changePassword({ currentPassword: 'synthetic', newPassword: 'changed synthetic' })
    expect(f.desktop.locked).toBe(true); expect(f.servers.vaultState).toBe('locked')
    await security.unlock('changed synthetic', true); await security.lockDesktop()
    await expect(security.unlock('wrong synthetic', true)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    expect(f.servers.vaultState).toBe('locked')
  })
})
