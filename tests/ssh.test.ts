import { afterEach, describe, expect, it } from 'vitest'
import { Server as SSHServer, utils, type Connection } from 'ssh2'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'

// ssh2's Ed25519 generator strips real leading-zero public bytes (intermittent invalid fixtures).
// Use ECDSA for generated fixtures; production key parsing/verification remains unchanged.
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function fixture(options: { port?: number; hostKey?: string; privateKey?: string; hold?: boolean } = {}) {
  const hostKey = options.hostKey ?? utils.generateKeyPairSync('ecdsa', { bits: 256 }).private
  let auths = 0
  let sessions = 0
  let authSeen!: () => void
  const authentication = new Promise<void>((resolve) => { authSeen = resolve })
  const connections = new Set<Connection>()
  const publicKey = options.privateKey ? utils.parseKey(options.privateKey) : undefined
  const server = new SSHServer({ hostKeys: [hostKey] }, (client) => {
    connections.add(client)
    client.on('error', () => {})
    client.on('close', () => connections.delete(client))
    client.on('authentication', (ctx) => {
      auths++; authSeen()
      if (options.hold) return
      if (ctx.method === 'password' && ctx.username === 'test' && ctx.password === 'synthetic-password') return ctx.accept()
      if (ctx.method === 'publickey' && publicKey && !(publicKey instanceof Error) && !Array.isArray(publicKey)
        && ctx.key.data.equals(publicKey.getPublicSSH())
        && (!ctx.signature || publicKey.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true)) return ctx.accept()
      ctx.reject()
    })
    client.on('session', () => { sessions++ })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    for (const connection of connections) connection.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  cleanup.push(close)
  return { port, close, authentication, get auths() { return auths }, get sessions() { return sessions } }
}
function setup(port: number, privateKey?: string, timeout = 2500) {
  const service = new ServerService(new Store(':memory:'), timeout)
  service.unlock(randomBytes(32))
  cleanup.push(() => service.close())
  const credential = service.saveCredential(privateKey ? { name: 'test key', kind: 'private-key', privateKey } : { name: 'test password', kind: 'password', password: 'synthetic-password' })
  const server = service.saveServer({ name: 'local test', host: '127.0.0.1', port, username: 'test', credentialId: credential.id })
  return { service, server, credential }
}

describe('SSH identity and authentication boundary', () => {
  it('requires host trust before any authentication, then authenticates without opening a session', async () => {
    const ssh = await fixture()
    const { service, server } = setup(ssh.port)
    const challenge = await service.testConnection(server.id)
    expect(challenge.status).toBe('host-key-required')
    expect(ssh.auths).toBe(0)
    if (challenge.status !== 'host-key-required') throw new Error('Expected challenge')
    service.trustHost(challenge.challengeId)
    expect((await service.testConnection(server.id)).status).toBe('connected')
    expect(ssh.auths).toBeGreaterThan(0)
    expect(ssh.sessions).toBe(0)
  })
  it('saves an unbound server, binds a credential for authentication, and blocks after unbinding', async () => {
    const ssh = await fixture()
    const { service, server, credential } = setup(ssh.port)
    const { revision: _revision, createdAt: _createdAt, ...input } = server
    const unbound = service.saveServer({ ...input, credentialId: null })
    await expect(service.testConnection(unbound.id)).rejects.toMatchObject({ code: 'CREDENTIAL_REQUIRED' })
    expect(ssh.auths).toBe(0)
    service.saveServer({ ...input, credentialId: credential.id })
    const challenge = await service.testConnection(server.id)
    if (challenge.status !== 'host-key-required') throw new Error('Expected challenge')
    expect(ssh.auths).toBe(0)
    service.trustHost(challenge.challengeId)
    expect((await service.testConnection(server.id)).status).toBe('connected')
    const auths = ssh.auths
    service.saveServer({ ...input, credentialId: null })
    await expect(service.testConnection(server.id)).rejects.toMatchObject({ code: 'CREDENTIAL_REQUIRED' })
    expect(ssh.auths).toBe(auths)
    expect(ssh.sessions).toBe(0)
    service.deleteCredential(credential.id)
  })
  it('authenticates using a saved private key', async () => {
    const privateKey = utils.generateKeyPairSync('ecdsa', { bits: 256 }).private
    const ssh = await fixture({ privateKey })
    const { service, server } = setup(ssh.port, privateKey)
    const challenge = await service.testConnection(server.id)
    if (challenge.status !== 'host-key-required') throw new Error('Expected challenge')
    service.trustHost(challenge.challengeId)
    expect((await service.testConnection(server.id)).status).toBe('connected')
  })
  it('blocks a changed host key before sending authentication credentials', async () => {
    const ssh = await fixture()
    const { service, server } = setup(ssh.port)
    const challenge = await service.testConnection(server.id)
    if (challenge.status !== 'host-key-required') throw new Error('Expected challenge')
    service.trustHost(challenge.challengeId)
    await ssh.close()
    const replacement = await fixture({ port: ssh.port })
    await expect(service.testConnection(server.id)).rejects.toThrow('指纹')
    expect(replacement.auths).toBe(0)
  })
  it('invalidates pending trust when configuration changes or the vault locks', async () => {
    const ssh = await fixture()
    const { service, server } = setup(ssh.port)
    const challenge = await service.testConnection(server.id)
    if (challenge.status !== 'host-key-required') throw new Error('Expected challenge')
    const { revision: _revision, createdAt: _createdAt, ...input } = server
    service.saveServer({ ...input, username: 'changed' })
    expect(() => service.trustHost(challenge.challengeId)).toThrow('过期')
    const second = await service.testConnection(server.id)
    if (second.status !== 'host-key-required') throw new Error('Expected challenge')
    service.lock()
    expect(() => service.trustHost(second.challengeId)).toThrow('已锁定')
    await expect(service.testConnection(server.id)).rejects.toThrow('已锁定')
  })
  it('cancels an in-flight authentication attempt when locked', async () => {
    const ssh = await fixture({ hold: true })
    const { service, server } = setup(ssh.port)
    const challenge = await service.testConnection(server.id)
    if (challenge.status !== 'host-key-required') throw new Error('Expected challenge')
    service.trustHost(challenge.challengeId)
    const result = service.testConnection(server.id)
    const assertion = expect(result).rejects.toThrow('已锁定')
    await ssh.authentication
    service.lock()
    await assertion
  })
  it('reports authentication failure without returning raw server error details', async () => {
    const ssh = await fixture()
    const { service, server, credential } = setup(ssh.port)
    service.saveCredential({ id: credential.id, name: 'test password', kind: 'password', password: 'wrong-synthetic-password' })
    const challenge = await service.testConnection(server.id)
    if (challenge.status !== 'host-key-required') throw new Error('Expected challenge')
    service.trustHost(challenge.challengeId)
    await expect(service.testConnection(server.id)).rejects.toThrow('认证失败')
  })
  it('times out an authentication that never completes', async () => {
    const ssh = await fixture({ hold: true })
    const { service, server } = setup(ssh.port, undefined, 200)
    const challenge = await service.testConnection(server.id)
    if (challenge.status !== 'host-key-required') throw new Error('Expected challenge')
    service.trustHost(challenge.challengeId)
    await expect(service.testConnection(server.id)).rejects.toThrow('超时')
  })
  it('cancels an active authentication when its server configuration changes', async () => {
    const ssh = await fixture({ hold: true })
    const { service, server } = setup(ssh.port)
    const challenge = await service.testConnection(server.id)
    if (challenge.status !== 'host-key-required') throw new Error('Expected challenge')
    service.trustHost(challenge.challengeId)
    const pending = expect(service.testConnection(server.id)).rejects.toThrow('配置已修改')
    await ssh.authentication
    const { revision: _revision, createdAt: _createdAt, ...input } = server
    service.saveServer({ ...input, name: 'edited' })
    await pending
  })
})
