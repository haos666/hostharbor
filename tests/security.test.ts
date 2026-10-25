import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { KeyFile, type OsProtection } from '../src/core/security/key-file'
import { SecurityService } from '../src/core/security/service'
import { createEnvelope, parseEnvelope, unwrap } from '../src/core/security/envelope'
import { ServerService } from '../src/core/servers/service'
import { Store } from '../src/core/storage/database'

const password = 'synthetic password alpha 123'
const nextPassword = 'synthetic password bravo 456'
const recovery = 'synthetic recovery code alpha 123456789'
const nextRecovery = 'synthetic recovery code bravo 987654321'
// A deliberately transparent OS adapter: verifies password protection even without OS secrecy.
const os: OsProtection = { async encrypt(value) { return Buffer.from(value) }, async decrypt(value) { return value.toString() } }
const fixtures: { directory: string; core: ServerService }[] = []
function fixture(adapter = os) {
  const directory = mkdtempSync(join(tmpdir(), 'hostharbor-security-'))
  const core = new ServerService(new Store(join(directory, 'vault.sqlite')))
  const transport = { async call<T = unknown>(method: string, value?: unknown): Promise<T> {
    if (method === 'lock') core.lock()
    else if (method === 'unlock') core.unlock(value as Buffer)
    else if (method === 'validateKey') core.validateKey(value as Buffer)
    else throw new Error('Unexpected method')
    return undefined as T
  } }
  const keys = new KeyFile(directory, adapter)
  const service = new SecurityService(keys, transport)
  fixtures.push({ directory, core })
  return { directory, core, keys, service, transport }
}
afterEach(() => { vi.useRealTimers(); for (const f of fixtures.splice(0)) { f.core.close(); rmSync(f.directory, { recursive: true, force: true }) } })

describe('password vault protection', { timeout: 15000 }, () => {
  it('requires password, preserves records after lock/restart and stores neither proof nor raw key', async () => {
    const f = fixture()
    await f.service.setup({ password, recovery })
    expect(f.core.vaultState).toBe('not-configured')
    expect(() => f.core.listCredentials()).toThrow()
    await expect(f.keys.legacyKey()).rejects.toThrow()
    await f.service.unlock(password)
    const record = f.core.saveCredential({ name: 'synthetic', kind: 'password', password: 'synthetic SSH secret' })
    const key = await unwrap(await f.keys.envelope(), password, 'password')
    const disk = readFileSync(f.keys.path)
    expect(disk.includes(key)).toBe(false)
    expect(disk.includes(Buffer.from(key.toString('base64')))).toBe(false)
    for (const text of [password, recovery, 'synthetic SSH secret']) expect(disk.includes(Buffer.from(text))).toBe(false)
    key.fill(0)
    await f.service.lock()
    const restarted = new SecurityService(new KeyFile(f.directory, os), f.transport)
    await restarted.unlock(password)
    expect(f.core.listCredentials()[0].id).toBe(record.id)
  })
  it('fails closed on a wrong password, recovery, malformed input and rate limits retries', async () => {
    const f = fixture(); await f.service.setup({ password, recovery }); await f.service.unlock(password)
    await expect(f.service.unlock('wrong')).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    expect(() => f.core.listCredentials()).toThrow()
    await expect(f.service.unlock(password)).rejects.toMatchObject({ code: 'SECURITY_RETRY' })
    const fresh = new SecurityService(f.keys, f.transport)
    await expect(fresh.resetPassword({ recovery: 'wrong', newPassword: nextPassword })).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    const another = new SecurityService(f.keys, f.transport)
    await expect(another.unlock({ password })).rejects.toMatchObject({ code: 'SECURITY_INPUT' })
  })
  it('changes password using the old password; recovery resets it and preserves the records', async () => {
    const f = fixture(); await f.service.setup({ password, recovery }); await f.service.unlock(password)
    const record = f.core.saveCredential({ name: 'retained', kind: 'password', password: 'synthetic' })
    await f.service.changePassword({ currentPassword: password, newPassword: nextPassword })
    expect(() => f.core.listCredentials()).toThrow()
    await expect(unwrap(await f.keys.envelope(), password, 'password')).rejects.toThrow()
    await f.service.unlock(nextPassword)
    expect(f.core.listCredentials()[0].id).toBe(record.id)
    await f.service.resetPassword({ recovery, newPassword: password })
    await expect(unwrap(await f.keys.envelope(), nextPassword, 'password')).rejects.toThrow()
    await f.service.unlock(password)
    expect(f.core.listCredentials()[0].id).toBe(record.id)
  })
  it('requires both current proofs to rotate recovery; old recovery no longer works', async () => {
    const f = fixture(); await f.service.setup({ password, recovery })
    await expect(f.service.changeRecovery({ currentPassword: password, currentRecovery: 'wrong', newRecovery: nextRecovery })).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    const fresh = new SecurityService(f.keys, f.transport)
    await fresh.changeRecovery({ currentPassword: password, currentRecovery: recovery, newRecovery: nextRecovery })
    await expect(unwrap(await f.keys.envelope(), recovery, 'recovery')).rejects.toThrow()
    await fresh.resetPassword({ recovery: nextRecovery, newPassword: nextPassword })
    await fresh.unlock(nextPassword)
  })
  it('migrates legacy data without retaining an OS-only master-key copy', async () => {
    const f = fixture(); const original = randomBytes(32)
    writeFileSync(f.keys.path, original.toString('base64'))
    f.core.unlock(original)
    const record = f.core.saveCredential({ name: 'legacy', kind: 'password', password: 'synthetic' })
    await expect(f.service.unlock(password)).rejects.toMatchObject({ code: 'SECURITY_REQUIRED' })
    await f.service.setup({ password, recovery })
    const restored = await unwrap(await f.keys.envelope(), recovery, 'recovery')
    expect(restored.equals(original)).toBe(true)
    await expect(f.keys.legacyKey()).rejects.toThrow()
    expect(readFileSync(f.keys.path).includes(Buffer.from(original.toString('base64')))).toBe(false)
    await f.service.unlock(password)
    expect(f.core.listCredentials()[0].id).toBe(record.id)
    restored.fill(0); original.fill(0)
  })
  it('preserves the prior file on OS write failure; fresh setup can retry without orphaning the DB', async () => {
    let fail = false
    const f = fixture({ ...os, async encrypt(value) { if (fail) throw new Error('synthetic write failure'); return Buffer.from(value) } })
    fail = true
    await expect(f.service.setup({ password, recovery })).rejects.toThrow()
    expect(f.core.vaultState).toBe('not-configured')
    expect(f.keys.mode).toBe('not-configured')
    fail = false; await f.service.setup({ password, recovery })
    const before = readFileSync(f.keys.path)
    fail = true
    await expect(f.service.changePassword({ currentPassword: password, newPassword: nextPassword })).rejects.toThrow()
    expect(readFileSync(f.keys.path).equals(before)).toBe(true)
    expect(() => f.core.listCredentials()).toThrow()
    fail = false; await f.service.unlock(password)
  })
  it('rejects corrupted and cross-role envelopes', async () => {
    const key = randomBytes(32); const envelope = await createEnvelope(key, password, recovery)
    await expect(unwrap({ ...envelope, password: envelope.recovery }, recovery, 'password')).rejects.toThrow()
    expect(() => parseEnvelope(JSON.stringify({ ...envelope, version: 99 }))).toThrow()
    expect(() => parseEnvelope(JSON.stringify({ ...envelope, password: { ...envelope.password, salt: '' } }))).toThrow()
    key.fill(0)
  })
  it('aborts setup if locking occurs while OS protection is pending', async () => {
    let release: (() => void) | undefined
    const f = fixture({ ...os, async encrypt(value) { await new Promise<void>((resolve) => { release = resolve }); return Buffer.from(value) } })
    const pending = f.service.setup({ password, recovery })
    await vi.waitFor(() => expect(release).toBeDefined(), { timeout: 10000 })
    await f.service.lock(); release!()
    await expect(pending).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    expect(f.keys.mode).toBe('not-configured')
    expect(() => f.core.listCredentials()).toThrow()
  })
  it('locking during password derivation prevents a late unlock and rejects concurrent security requests', async () => {
    const f = fixture(); await f.service.setup({ password, recovery })
    const pending = f.service.unlock(password)
    await expect(f.service.unlock(password)).rejects.toMatchObject({ code: 'SECURITY_BUSY' })
    await f.service.lock()
    await expect(pending).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    expect(() => f.core.listCredentials()).toThrow()
  })
  it('does not create a replacement key if an existing vault loses its key file', async () => {
    const f = fixture(); await f.service.setup({ password, recovery }); await f.service.unlock(password)
    f.core.saveCredential({ name: 'retained', kind: 'password', password: 'synthetic' })
    await f.service.lock(); rmSync(f.keys.path)
    await expect(f.service.setup({ password: nextPassword, recovery: nextRecovery })).rejects.toMatchObject({ code: 'VAULT_CORRUPT' })
    expect(f.keys.mode).toBe('not-configured')
    expect(f.core.store.listCredentials()).toHaveLength(1)
  })
  it('an aborted file commit leaves the previous password usable', async () => {
    const f = fixture(); await f.service.setup({ password, recovery })
    const before = readFileSync(f.keys.path)
    await expect(f.keys.save(await f.keys.envelope(), () => { throw new Error('abort') })).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    expect(readFileSync(f.keys.path).equals(before)).toBe(true)
    await f.service.unlock(password)
  })
  it('accepts single-character, whitespace and arbitrary Unicode proofs without composition rules', async () => {
    const f = fixture()
    await f.service.setup({ password: '1', recovery: '2' })
    await f.service.unlock('1')
    await f.service.changePassword({ currentPassword: '1', newPassword: ' ' })
    await f.service.unlock(' ')
    await f.service.resetPassword({ recovery: '2', newPassword: '密🙂 !' })
    await f.service.unlock('密🙂 !')
    await f.service.changeRecovery({ currentPassword: '密🙂 !', currentRecovery: '2', newRecovery: '码' })
    await f.service.resetPassword({ recovery: '码', newPassword: '3' })
    await f.service.unlock('3')
  })
  it('does not allow passwordless setup over an existing password vault or empty/equal proofs', async () => {
    const f = fixture()
    await expect(f.service.setup({ password: '', recovery })).rejects.toThrow()
    await expect(f.service.setup({ password: recovery, recovery })).rejects.toThrow()
    await f.service.setup({ password, recovery })
    const before = readFileSync(f.keys.path)
    await expect(f.service.setup({ password: nextPassword, recovery: nextRecovery })).rejects.toMatchObject({ code: 'VAULT_EXISTS' })
    expect(readFileSync(f.keys.path).equals(before)).toBe(true)
  })
})
