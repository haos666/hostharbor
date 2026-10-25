import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'
import { utils } from 'ssh2'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { open, seal } from '../src/core/credentials/crypto'

const resources: { service: ServerService; directory: string }[] = []
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'hostharbor-test-'))
  const store = new Store(join(directory, 'vault.sqlite'))
  const service = new ServerService(store)
  const key = randomBytes(32)
  service.unlock(key)
  resources.push({ service, directory })
  return { service, store, key, directory }
}
afterEach(() => { for (const resource of resources.splice(0)) { resource.service.close(); rmSync(resource.directory, { recursive: true, force: true }) } })

describe('vault and local persistence', () => {
  it('binds ciphertext to its context and detects modified bytes and wrong keys', () => {
    const key = randomBytes(32)
    const encrypted = seal(key, 'credential:a:password', Buffer.from('synthetic-test-secret'))
    expect(open(key, 'credential:a:password', encrypted).toString()).toBe('synthetic-test-secret')
    expect(() => open(key, 'credential:b:password', encrypted)).toThrow('校验失败')
    expect(() => open(randomBytes(32), 'credential:a:password', encrypted)).toThrow('校验失败')
    encrypted[encrypted.length - 1] ^= 1
    expect(() => open(key, 'credential:a:password', encrypted)).toThrow('校验失败')
  })
  it('persists encrypted credentials without leaking their contents through metadata or disk', () => {
    const { service, directory } = setup()
    const summary = service.saveCredential({ name: 'test login', kind: 'password', password: 'synthetic-unique-secret-573829' })
    expect(Object.keys(summary).sort()).toEqual(['createdAt', 'id', 'kind', 'name', 'revision'])
    expect(JSON.stringify(service.listCredentials())).not.toContain('synthetic-unique-secret-573829')
    for (const filename of readdirSync(directory)) expect(readFileSync(join(directory, filename)).includes(Buffer.from('synthetic-unique-secret-573829'))).toBe(false)
  })
  it('starts locked after reopening and rejects the wrong master key', () => {
    const { service, key, directory } = setup()
    service.saveCredential({ name: 'test', kind: 'password', password: 'dummy' })
    service.close()
    const reopened = new ServerService(new Store(join(directory, 'vault.sqlite')))
    resources[resources.length - 1].service = reopened
    expect(reopened.vaultState).toBe('locked')
    expect(() => reopened.listCredentials()).toThrow('已锁定')
    expect(() => reopened.unlock(randomBytes(32))).toThrow('校验失败')
    expect(reopened.vaultState).toBe('locked')
    reopened.unlock(key)
    expect(reopened.listCredentials()).toHaveLength(1)
  })
  it('enforces credential references and updates server revision without losing identity', () => {
    const { service } = setup()
    const credential = service.saveCredential({ name: 'test', kind: 'password', password: 'dummy' })
    const server = service.saveServer({ name: 'first', host: 'LOCALHOST', port: 22, username: 'test', credentialId: credential.id })
    expect(() => service.deleteCredential(credential.id)).toThrow('引用')
    const edited = service.saveServer({ id: server.id, name: 'second', host: server.host, port: server.port, username: server.username, credentialId: credential.id })
    expect(edited.id).toBe(server.id)
    expect(edited.revision).toBe(2)
    expect(edited.host).toBe('localhost')
    service.deleteServer(server.id)
    service.deleteCredential(credential.id)
    expect(service.listCredentials()).toEqual([])
  })
  it('saves without credentials and invalidates metadata revision when a credential changes', () => {
    const { service, directory, key } = setup()
    const server = service.saveServer({ name: 'unbound', host: 'localhost', port: 22, username: 'user', credentialId: null })
    const credential = service.saveCredential({ name: 'login', kind: 'password', password: 'dummy' })
    expect(credential.revision).toBe(1)
    expect(service.saveCredential({ id: credential.id, name: 'login', kind: 'password', password: 'updated' }).revision).toBe(2)
    service.close()
    const reopened = new ServerService(new Store(join(directory, 'vault.sqlite')))
    resources[resources.length - 1].service = reopened
    reopened.unlock(key)
    expect(reopened.listServers()[0].credentialId).toBeNull()
    expect(reopened.listServers()[0].id).toBe(server.id)
  })
  it('migrates v1 data, ciphertext, bindings and known hosts while retaining reference constraints', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hostharbor-v1-'))
    const path = join(directory, 'vault.sqlite')
    const raw = new DatabaseSync(path)
    const key = randomBytes(32), credentialId = randomUUID(), serverId = randomUUID()
    const encrypted = seal(key, `credential:${credentialId}:password`, Buffer.from(JSON.stringify({ password: 'synthetic' })))
    const hostKey = randomBytes(32)
    raw.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value BLOB NOT NULL);
      CREATE TABLE credentials (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('password','private-key')), secret BLOB NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, credentialId TEXT NOT NULL REFERENCES credentials(id) ON DELETE RESTRICT, revision INTEGER NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE known_hosts (host TEXT NOT NULL, port INTEGER NOT NULL, key BLOB NOT NULL, fingerprint TEXT NOT NULL, confirmedAt INTEGER NOT NULL, PRIMARY KEY(host,port));
      PRAGMA user_version=1;
    `)
    raw.prepare('INSERT INTO metadata VALUES(?,?)').run('vault-check', seal(key, 'vault-check', Buffer.from('HostHarbor vault check v1')))
    raw.prepare('INSERT INTO credentials VALUES(?,?,?,?,?)').run(credentialId, 'legacy login', 'password', encrypted, 123)
    raw.prepare('INSERT INTO servers VALUES(?,?,?,?,?,?,?,?)').run(serverId, 'legacy server', 'localhost', 22, 'user', credentialId, 4, 456)
    raw.prepare('INSERT INTO known_hosts VALUES(?,?,?,?,?)').run('localhost', 22, hostKey, 'synthetic-fingerprint', 789)
    raw.close()
    const store = new Store(path), service = new ServerService(store)
    resources.push({ directory, service }); service.unlock(key)
    expect(service.listServers()[0]).toMatchObject({ id: serverId, credentialId, revision: 4, createdAt: 456 })
    expect(service.listCredentials()[0]).toMatchObject({ id: credentialId, revision: 1, createdAt: 123 })
    expect(Buffer.from(store.getCredential(credentialId)!.secret).equals(encrypted)).toBe(true)
    expect(Buffer.from(store.getHost('localhost', 22)!.key).equals(hostKey)).toBe(true)
    expect(() => service.deleteCredential(credentialId)).toThrow('引用')
    const { revision: _revision, createdAt: _createdAt, ...input } = service.listServers()[0]
    service.saveServer({ ...input, credentialId: null })
    service.deleteCredential(credentialId)
    expect(service.listServers()[0].credentialId).toBeNull()
    expect(service.listServers()[0].route).toEqual({ type: 'direct' })
    expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(store.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 13 })
  })
  it('rejects locked mutations, malformed input and invalid private keys', () => {
    const { service } = setup()
    expect(() => service.saveCredential({ name: 'x', kind: 'private-key', privateKey: 'not-a-private-key' })).toThrow('私钥')
    expect(() => service.saveServer({ name: 'x', host: 'host;command', port: -1, username: 'u', credentialId: 'bad' })).toThrow('输入')
    service.lock()
    expect(() => service.saveCredential({ name: 'x', kind: 'password', password: 'dummy' })).toThrow('已锁定')
    expect(() => service.listServers()).toThrow('已锁定')
  })
  it('detects tampered stored credentials before attempting a network connection', async () => {
    const { service, store } = setup()
    const credential = service.saveCredential({ name: 'test', kind: 'password', password: 'dummy' })
    const server = service.saveServer({ name: 'test', host: '127.0.0.1', port: 1, username: 'u', credentialId: credential.id })
    const stored = store.getCredential(credential.id)!
    const bytes = Buffer.from(stored.secret)
    bytes[bytes.length - 1] ^= 1
    store.db.prepare('UPDATE credentials SET secret=? WHERE id=?').run(bytes, credential.id)
    await expect(service.testConnection(server.id)).rejects.toThrow('校验失败')
  })
  it('supports an encrypted OpenSSH key and rejects an incorrect passphrase', () => {
    const { service } = setup()
    const privateKey = utils.generateKeyPairSync('ecdsa', { bits: 256, cipher: 'aes256-cbc', passphrase: 'synthetic-passphrase', rounds: 16 }).private
    expect(() => service.saveCredential({ name: 'key', kind: 'private-key', privateKey, passphrase: 'wrong-synthetic-passphrase' })).toThrow('私钥')
    const saved = service.saveCredential({ name: 'key', kind: 'private-key', privateKey, passphrase: 'synthetic-passphrase' })
    expect(saved.kind).toBe('private-key')
    expect(JSON.stringify(service.listCredentials())).not.toContain('synthetic-passphrase')
  })
})
