import { Client, type ConnectConfig } from 'ssh2'
import { createConnection } from 'node:net'
import type { Readable } from 'node:stream'
import { SocksClient } from 'socks'
import type { ServerRecord } from '../../shared/contracts'
import { AppError, type ErrorCode } from '../../shared/errors'

type Resource = { destroy(): unknown }
// One lifetime and deadline for TCP, proxy negotiation, both SSH handshakes and forwarding.
export class ConnectionScope {
  readonly controller = new AbortController()
  private resources: Resource[] = []
  private closed = false
  private readonly timer: ReturnType<typeof setTimeout>
  readonly deadline: number
  constructor(timeout: number) {
    this.deadline = Date.now() + timeout
    this.timer = setTimeout(() => this.fail(new AppError('CONNECTION_TIMEOUT')), timeout)
  }
  get remaining(): number { return Math.max(1, this.deadline - Date.now()) }
  fail(error: Error): void { if (!this.closed && !this.controller.signal.aborted) { this.controller.abort(error); for (const resource of [...this.resources].reverse()) resource.destroy() } }
  own<T extends Resource>(resource: T): T { if (this.closed || this.controller.signal.aborted) resource.destroy(); else this.resources.push(resource); return resource }
  async wait<T>(promise: Promise<T>): Promise<T> {
    const signal = this.controller.signal
    if (signal.aborted) { void promise.catch(() => {}); throw signal.reason }
    let abort!: () => void
    try {
      return await Promise.race([promise, new Promise<never>((_resolve, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }) })])
    } finally { signal.removeEventListener('abort', abort) }
  }
  connected(): void { clearTimeout(this.timer) }
  close(): void { this.closed = true; clearTimeout(this.timer); for (const resource of [...this.resources].reverse()) resource.destroy(); this.resources = [] }
}
export type SshSecret = Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>
export async function authenticate(scope: ConnectionScope, server: ServerRecord, secret: SshSecret, verify: (key: Buffer) => boolean, challengeError: () => Error | undefined, sock?: Readable): Promise<Client> {
  scope.controller.signal.throwIfAborted()
  const client = scope.own(new Client())
  const result = new Promise<Client>((resolve, reject) => {
    client.on('ready', () => resolve(client))
    client.on('error', (error: Error & { level?: string }) => {
      const code: ErrorCode = error.level === 'client-authentication' ? 'AUTH_FAILED' : error.level === 'client-timeout' ? 'CONNECTION_TIMEOUT' : 'CONNECTION_FAILED'
      scope.fail(challengeError() ?? new AppError(code))
    })
    client.on('close', () => scope.fail(challengeError() ?? new AppError('CONNECTION_FAILED')))
    try { client.connect({ host: server.host, port: server.port, username: server.username, ...secret, sock, readyTimeout: scope.remaining, tryKeyboard: false, agentForward: false, hostVerifier: verify }) }
    catch { reject(new AppError('CONNECTION_FAILED')) }
  })
  try { return await scope.wait(result) }
  finally { delete secret.password; delete secret.privateKey; delete secret.passphrase }
}
export async function forward(scope: ConnectionScope, jump: Client, target: ServerRecord): Promise<Readable> {
  scope.controller.signal.throwIfAborted()
  return scope.wait(new Promise((resolve, reject) => {
    jump.forwardOut('127.0.0.1', 0, target.host, target.port, (error, stream) => {
      if (error) { reject(new AppError('PROXY_FAILED')); return }
      stream.on('error', () => scope.fail(new AppError('PROXY_FAILED')))
      resolve(scope.own(stream))
    })
  }))
}
export async function socks5(scope: ConnectionScope, route: Extract<ServerRecord['route'], { type: 'socks5' }>, target: ServerRecord, password?: string): Promise<Readable> {
  scope.controller.signal.throwIfAborted()
  const socket = scope.own(createConnection({ host: route.host, port: route.port }))
  socket.on('error', () => scope.fail(new AppError('PROXY_FAILED')))
  try {
    await scope.wait(new Promise<void>((resolve) => socket.once('connect', resolve)))
    const authentication = route.authentication
    const result = await scope.wait(SocksClient.createConnection({ command: 'connect', proxy: { host: route.host, port: route.port, type: 5, ...(authentication.type === 'password' ? { userId: authentication.username, password } : {}) }, destination: { host: target.host, port: target.port }, existing_socket: socket, timeout: scope.remaining + 1000 }))
    return result.socket
  } catch { scope.controller.signal.throwIfAborted(); throw new AppError('PROXY_FAILED') }
}
