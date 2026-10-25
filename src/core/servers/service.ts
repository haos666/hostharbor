import { createHash, hkdfSync, randomUUID, timingSafeEqual } from 'node:crypto'
import { utils, type Client, type ConnectConfig } from 'ssh2'
import type { ConnectionTest, CredentialInput, CredentialSummary, ServerRecord } from '../../shared/contracts'
import { AppError, type ErrorCode } from '../../shared/errors'
import { authenticate, ConnectionScope, forward, socks5 } from '../ssh/connection'
import { Store } from '../storage/database'
import { open, seal } from '../credentials/crypto'
import { credentialSchema, idSchema, parse, serverSchema } from '../validation'

class HostChallenge extends Error { constructor(readonly result: Extract<ConnectionTest, { status: 'host-key-required' }>) { super('Host verification required') } }
const CHECK = 'HostHarbor vault check v1'
interface Challenge {
  id: string; serverId: string; revision: number; host: string; port: number
  key: Buffer; fingerprint: string; expiresAt: number
}
export class ServerService {
  private key: Buffer | null = null
  private challenges = new Map<string, Challenge>()
  readonly invalidated = new Set<(code: ErrorCode) => void>()
  private recordingKey(): Buffer { return Buffer.from(hkdfSync('sha256', this.unlocked(), Buffer.alloc(0), 'hostharbor-recording-v1', 32)) }
  protect(context: string, value: Buffer): Buffer { const key = this.recordingKey(); try { return seal(key, `operation:${context}`, value) } finally { key.fill(0) } }
  reveal(context: string, value: Uint8Array): Buffer { const key = this.recordingKey(); try { return open(key, `operation:${context}`, value) } finally { key.fill(0) } }
  assertUnlocked(): void { this.unlocked() }
  private active = new Set<(code: ErrorCode) => void>()
  constructor(readonly store: Store, private readonly timeoutMs = 12000) {}

  get vaultState(): 'not-configured' | 'locked' | 'unlocked' {
    return this.key ? 'unlocked' : this.store.getCheck() ? 'locked' : 'not-configured'
  }
  private unlocked(): Buffer {
    if (!this.key) throw new AppError('VAULT_LOCKED')
    return this.key
  }
  validateKey(input: Buffer): void {
    if (input.length !== 32) throw new AppError('KEY_UNAVAILABLE')
    const check = this.store.getCheck()
    if (check) {
      const plaintext = open(input, 'vault-check', check)
      try {
        if (plaintext.toString() !== CHECK) throw new AppError('VAULT_CORRUPT')
      } finally { plaintext.fill(0) }
    } else {
      if (this.store.listCredentials().length !== 0) throw new AppError('VAULT_CORRUPT')

    }
  }
  unlock(input: Buffer): void {
    this.lock()
    this.validateKey(input)
    if (!this.store.getCheck()) this.store.setCheck(seal(input, 'vault-check', Buffer.from(CHECK)))
    this.key = Buffer.from(input)
  }
  lock(): void {
    this.key?.fill(0)
    this.key = null
    for (const notify of this.invalidated) notify('VAULT_LOCKED')
    this.challenges.clear()
    for (const cancel of [...this.active]) cancel('VAULT_LOCKED')
  }
  private changed(): void {
    for (const notify of this.invalidated) notify('CONFIG_CHANGED')
    this.challenges.clear()
    for (const cancel of [...this.active]) cancel('CONFIG_CHANGED')
  }
  listCredentials(): CredentialSummary[] { this.unlocked(); return this.store.listCredentials() }
  listServers(): ServerRecord[] { this.unlocked(); return this.store.listServers() }

  saveCredential(raw: unknown): CredentialSummary {
    const key = this.unlocked()
    const input = parse(credentialSchema, raw)
    if (input.id && !this.store.getCredential(input.id)) throw new AppError('NOT_FOUND')
    if (input.id && input.kind !== 'password' && this.store.listServers().some(s => s.elevation?.type === 'sudo' && ((s.elevation.passwordSource === 'login' && s.credentialId === input.id) || (s.elevation.passwordSource === 'credential' && s.elevation.credentialId === input.id)))) throw new AppError('SUDO_CREDENTIAL')
    if (input.id && input.kind !== 'password' && this.store.listServers().some((server) => server.route.type === 'socks5' && server.route.authentication.type === 'password' && server.route.authentication.credentialId === input.id)) throw new AppError('PROXY_CREDENTIAL')
    if (input.kind === 'private-key') {
      const parsed = utils.parseKey(input.privateKey, input.passphrase)
      if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey()) throw new AppError('INVALID_PRIVATE_KEY')
    }
    const id = input.id ?? randomUUID()
    const secret = input.kind === 'password' ? { password: input.password } : { privateKey: input.privateKey, passphrase: input.passphrase }
    const plaintext = Buffer.from(JSON.stringify(secret))
    let encrypted: Buffer
    try { encrypted = seal(key, `credential:${id}:${input.kind}`, plaintext) } finally { plaintext.fill(0) }
    this.changed()
    this.store.db.prepare(`INSERT INTO credentials(id,name,kind,secret,createdAt) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,secret=excluded.secret,revision=credentials.revision+1`).run(id, input.name, input.kind, encrypted, Date.now())
    return this.store.listCredentials().find((credential) => credential.id === id)!
  }
  deleteCredential(raw: unknown): void {
    this.unlocked()
    const id = parse(idSchema, raw)
    if (!this.store.getCredential(id)) throw new AppError('NOT_FOUND')
    if (this.store.listServers().some(s => s.elevation?.type === 'sudo' && s.elevation.credentialId === id)) throw new AppError('CREDENTIAL_IN_USE')
    if (this.store.listServers().some((server) => server.credentialId === id || (server.route.type === 'socks5' && server.route.authentication.type === 'password' && server.route.authentication.credentialId === id))) throw new AppError('CREDENTIAL_IN_USE')
    this.changed()
    this.store.db.prepare('DELETE FROM credentials WHERE id=?').run(id)
  }
  saveServer(raw: unknown): ServerRecord {
    this.unlocked()
    const input = parse(serverSchema, raw)
    if (input.credentialId !== null && !this.store.getCredential(input.credentialId)) throw new AppError('NOT_FOUND')
    if (input.id && !this.store.getServer(input.id)) throw new AppError('NOT_FOUND')
    const id = input.id ?? randomUUID()
    const elevation = input.elevation
    if (elevation.type === 'sudo' && elevation.passwordSource !== 'none') {
      const id = elevation.passwordSource === 'login' ? input.credentialId : elevation.credentialId
      if (!id || this.store.getCredential(id)?.kind !== 'password') throw new AppError('SUDO_CREDENTIAL')
    }
    const route = input.route
    if (route.type === 'ssh-jump') {
      const jump = this.store.getServer(route.serverId)
      if (!jump || jump.id === id || jump.route.type !== 'direct' || !jump.credentialId) throw new AppError('ROUTE_INVALID')
    }
    if (route.type === 'socks5' && route.authentication.type === 'password' && this.store.getCredential(route.authentication.credentialId)?.kind !== 'password') throw new AppError('PROXY_CREDENTIAL')
    if (this.store.listServers().some((server) => server.route.type === 'ssh-jump' && server.route.serverId === id) && (route.type !== 'direct' || !input.credentialId)) throw new AppError('SERVER_IN_USE')
    this.changed()
    this.store.db.prepare(`INSERT INTO servers(id,name,host,port,username,credentialId,revision,createdAt,route,elevation) VALUES(?,?,?,?,?,?,1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,username=excluded.username,credentialId=excluded.credentialId,route=excluded.route,elevation=excluded.elevation,revision=servers.revision+1`).run(id, input.name, input.host.toLowerCase(), input.port, input.username, input.credentialId, Date.now(), JSON.stringify(route), JSON.stringify(elevation))
    return this.store.getServer(id)!
  }
  deleteServer(raw: unknown): void {
    this.unlocked()
    const id = parse(idSchema, raw)
    if (!this.store.getServer(id)) throw new AppError('NOT_FOUND')
    if (this.store.listServers().some((server) => server.route.type === 'ssh-jump' && server.route.serverId === id)) throw new AppError('SERVER_IN_USE')
    this.changed()
    this.store.db.prepare('DELETE FROM servers WHERE id=?').run(id)
  }
  trustHost(raw: unknown): void {
    this.unlocked()
    const id = parse(idSchema, raw)
    const challenge = this.challenges.get(id)
    this.challenges.delete(id)
    if (!challenge || challenge.expiresAt <= Date.now() || this.store.getServer(challenge.serverId)?.revision !== challenge.revision) throw new AppError('CHALLENGE_EXPIRED')
    const known = this.store.getHost(challenge.host, challenge.port)
    if (known) {
      if (!Buffer.from(known.key).equals(challenge.key)) throw new AppError('HOST_KEY_CHANGED')
      return
    }
    this.store.db.prepare('INSERT INTO known_hosts(host,port,key,fingerprint,confirmedAt) VALUES(?,?,?,?,?)').run(challenge.host, challenge.port, challenge.key, challenge.fingerprint, Date.now())
  }
  private secret(credential: CredentialSummary & { secret: Uint8Array }): Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'> {
    const plaintext = open(this.unlocked(), `credential:${credential.id}:${credential.kind}`, credential.secret)
    try {
      const secret: unknown = JSON.parse(plaintext.toString())
      const combined = parse(credentialSchema, { ...(secret as object), name: credential.name, kind: credential.kind })
      return combined.kind === 'password' ? { password: combined.password } : { privateKey: combined.privateKey, passphrase: combined.passphrase }
    } catch { throw new AppError('VAULT_CORRUPT') } finally { plaintext.fill(0) }
  }

  elevationPassword(serverId: string): Buffer | undefined {
    this.unlocked()
    const server = this.store.getServer(serverId), e = server?.elevation
    if (!server || e?.type !== 'sudo') throw new AppError('SUDO_CREDENTIAL')
    if (e.passwordSource === 'none') return undefined
    const id = e.passwordSource === 'login' ? server.credentialId : e.credentialId
    const credential = id ? this.store.getCredential(id) : undefined
    if (!credential || credential.kind !== 'password') throw new AppError('SUDO_CREDENTIAL')
    const value = this.secret(credential).password!
    if (/[\r\n\0]/.test(value)) throw new AppError('SUDO_CREDENTIAL')
    return Buffer.from(value)
  }
  redactionValues(serverId: string): string[] {
    this.unlocked()
    const server = this.store.getServer(serverId)
    if (!server) throw new AppError('NOT_FOUND')
    const ids = [server.credentialId]
    if (server.elevation?.type === 'sudo' && server.elevation.passwordSource === 'credential') ids.push(server.elevation.credentialId!)
    if (server.route.type === 'ssh-jump') ids.push(this.store.getServer(server.route.serverId)?.credentialId ?? null)
    if (server.route.type === 'socks5' && server.route.authentication.type === 'password') ids.push(server.route.authentication.credentialId)
    return ids.flatMap((id) => {
      const credential = id ? this.store.getCredential(id) : undefined
      if (!credential) throw new AppError('CREDENTIAL_REQUIRED')
      const secret = this.secret(credential)
      return [secret.password, secret.passphrase, secret.privateKey, ...(typeof secret.privateKey === 'string' ? secret.privateKey.split(/\r?\n/).filter((line) => line && !line.startsWith('-----')) : [])].filter((s): s is string => typeof s === 'string' && s.length > 0)
    })
  }
  async testConnection(raw: unknown): Promise<ConnectionTest> {
    const started = Date.now()
    try { return await this.withConnection(raw, async (_client, _scope, fingerprint, server) => ({ status: 'connected' as const, serverId: server.id, fingerprint, durationMs: Date.now() - started })) }
    catch (error) { if (error instanceof HostChallenge) return error.result; throw error }
  }
  async withConnection<T>(raw: unknown, use: (client: Client, scope: ConnectionScope, fingerprint: string, server: ServerRecord) => Promise<T>, requireKnown = false, timeout = this.timeoutMs, onScope?: (scope: ConnectionScope) => void): Promise<T> {
    this.unlocked()
    const id = parse(idSchema, raw)
    const server = this.store.getServer(id)
    if (!server) throw new AppError('NOT_FOUND')
    if (!server.credentialId) throw new AppError('CREDENTIAL_REQUIRED')
    const scope = new ConnectionScope(timeout)
    onScope?.(scope)
    const cancel = (code: ErrorCode) => scope.fail(new AppError(code))
    this.active.add(cancel)
    let fingerprint = ''
    const connect = async (destination: ServerRecord, role: 'jump' | 'target', socket?: import('node:stream').Readable) => {
      this.unlocked(); scope.controller.signal.throwIfAborted()
      const credential = destination.credentialId ? this.store.getCredential(destination.credentialId) : undefined
      if (!credential) throw new AppError('CREDENTIAL_REQUIRED')
      let verificationError: Error | undefined
      const known = this.store.getHost(destination.host, destination.port)
      return authenticate(scope, destination, this.secret(credential), (rawKey) => {
        const value = `SHA256:${createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '')}`
        if (role === 'target') fingerprint = value
        if (known) {
          const pinned = Buffer.from(known.key)
          const match = pinned.length === rawKey.length && timingSafeEqual(pinned, rawKey)
          if (!match) verificationError = new AppError('HOST_KEY_CHANGED')
          return match
        }
        if (requireKnown) { verificationError = new AppError('HOST_KEY_REQUIRED'); return false }
        const challenge: Challenge = { id: randomUUID(), serverId: id, revision: server.revision, host: destination.host, port: destination.port, key: Buffer.from(rawKey), fingerprint: value, expiresAt: Date.now() + 300000 }
        for (const [pendingId, pending] of this.challenges) if (pending.expiresAt <= Date.now() || pending.serverId === id) this.challenges.delete(pendingId)
        if (this.challenges.size >= 100) this.challenges.delete(this.challenges.keys().next().value!)
        this.challenges.set(challenge.id, challenge)
        const parsedKey = utils.parseKey(rawKey)
        verificationError = new HostChallenge({ status: 'host-key-required', challengeId: challenge.id, host: destination.host, port: destination.port, fingerprint: value, keyType: parsedKey instanceof Error || Array.isArray(parsedKey) ? 'SSH' : parsedKey.type, expiresAt: challenge.expiresAt, role, serverName: destination.name })
        return false
      }, () => verificationError, socket)
    }
    let inUse = false
    try {
      let socket: import('node:stream').Readable | undefined
      if (server.route.type === 'ssh-jump') {
        const jump = this.store.getServer(server.route.serverId)
        if (!jump || jump.route.type !== 'direct' || jump.id === server.id) throw new AppError('ROUTE_INVALID')
        socket = await forward(scope, await connect(jump, 'jump'), server)
      } else if (server.route.type === 'socks5') {
        let password: string | undefined
        const authentication = server.route.authentication
        if (authentication.type === 'password') {
          const credential = this.store.getCredential(authentication.credentialId)
          if (!credential || credential.kind !== 'password') throw new AppError('PROXY_CREDENTIAL')
          password = this.secret(credential).password
          if (!password || Buffer.byteLength(password) > 255) throw new AppError('PROXY_CREDENTIAL')
        }
        socket = await socks5(scope, server.route, server, password)
      }
      const client = await connect(server, 'target', socket)
      this.unlocked(); scope.controller.signal.throwIfAborted()
      if (this.store.getServer(id)?.revision !== server.revision) throw new AppError('CONFIG_CHANGED')
      scope.connected()
      inUse = true
      return await use(client, scope, fingerprint, server)
    } catch (error) { if (inUse) throw error; throw error instanceof AppError || error instanceof HostChallenge ? error : new AppError('CONNECTION_FAILED') }
    finally { this.active.delete(cancel); scope.close() }
  }
  close(): void { this.lock(); this.store.close() }
}
