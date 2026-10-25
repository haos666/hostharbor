import { filePipeline } from './pipeline'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { dirname, join, basename, isAbsolute, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { posix } from 'node:path'
import { z } from 'zod'
import type { SFTPWrapper, Stats } from 'ssh2'
import type { ConnectionScope } from '../ssh/connection'
import type { OperationService } from '../operations/service'
import type { Operation, PolicyDecision } from '../../shared/contracts'
import { fileBrowseSchema, fileSettingsSchema, fileRequestSchema, localNameSchema, type FileAccess, type FileWorkspace, type TransferSpec, type TransferResult, type RemoteFile, type FileBrowseInput, type FileBrowseResult } from '../../shared/files'
import { AppError } from '../../shared/errors'
import { parse, idSchema } from '../validation'
const canonical = (p: string) => posix.normalize(p).replace(/\/+$/, '') || '/'
function call<T>(scope: ConnectionScope, fn: (cb: (err: Error | null | undefined, value?: T) => void) => void): Promise<T> {
  scope.controller.signal.throwIfAborted()
  return scope.wait(new Promise<T>((resolve, reject) => fn((e, value) => e ? reject(e) : resolve(value as T))))
}
const missing = (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 2
export class FileService {
  private stagingReady?: Promise<string>
  constructor(readonly operations: OperationService) {
    operations.fileAdapter = { browse: (client, scope, input, verify) => this.browseRemote(client, scope, input, verify), decision: (id, spec) => this.decision(id, spec), run: (op, client, scope, progress, mutation, recheck) => this.run(op, client, scope, progress, mutation, recheck) }
  }
  private key(serverId: string) { return `files:settings:v2:${serverId}` }
  access(profileId: string, serverId: string): FileAccess {
    this.operations.assertServerAccess(profileId, serverId)
    const key = this.key(serverId), row = this.operations.servers.store.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)
    // Never inherit previous per-profile local roots or automatic transfer grants.
    if (!row) return { serverId, revision: 0, uploadEnabled: false, uploadDirectory: '', maxFileSizeMiB: 500, verification: 'standard', idleTimeoutSeconds: 120, totalTimeoutMinutes: 120 }
    const data = this.operations.servers.reveal(key, row.value as Uint8Array)
    try { const value = fileSettingsSchema.parse(JSON.parse(data.toString())); if (value.serverId !== serverId) throw new Error(); return value }
    catch { throw new AppError('STORAGE_FAILED') } finally { data.fill(0) }
  }
  save(raw: unknown): FileAccess {
    const payload = parse(z.object({ profileId: idSchema }).passthrough(), raw), { profileId, ...settings } = payload
    const input = parse(fileSettingsSchema, settings), current = this.access(profileId, input.serverId)
    if (input.revision !== current.revision) throw new AppError('FILE_CHANGED')
    const next = { ...input, uploadDirectory: input.uploadDirectory ? canonical(input.uploadDirectory) : '', revision: current.revision + 1 }
    const key = this.key(input.serverId), data = Buffer.from(JSON.stringify(next))
    try { this.operations.servers.store.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, this.operations.servers.protect(key, data)) }
    catch { throw new AppError('STORAGE_FAILED') } finally { data.fill(0) }
    this.operations.invalidateFileAccess(undefined, input.serverId)
    return next
  }
  workspace(raw: unknown): FileWorkspace {
    const serverId = parse(idSchema, raw), desktopProfileId = this.operations.desktopProfile(serverId, 'desktop-files')
    return { desktopProfileId }
  }
  describe(profileId: string, serverId: string) {
    const policy = this.operations.policy.get()
    const downloadRequiresApproval = policy.downloadApprovalRequired?.[policy.mode] ?? true, uploadRequiresApproval = policy.uploadApprovalRequired?.[policy.mode] ?? true
    return { ...this.access(profileId, serverId), manualTransferApproval: downloadRequiresApproval || uploadRequiresApproval, uploadRequiresApproval, downloadRequiresApproval, downloadsPaused: policy.mode === 'paused', uploadsPaused: policy.mode === 'paused', overwriteSupported: false }
  }
  async start(profileId: string, raw: unknown, guard: () => void = () => {}): Promise<Operation> {
    const input = parse(fileRequestSchema, raw)
    if (input.direction === 'list') throw new AppError('FILE_BROWSE_API')
    const a = this.access(profileId, input.serverId)
    const request = { ...input, remotePath: input.direction === 'upload' ? posix.join(a.uploadDirectory || '/', input.remoteName!) : canonical(input.remotePath!) }
    // Canonicalize only existing parent directories; transfer approval binds the resulting full path.
    if (request.localPath) request.localPath = await this.localPath(request.localPath)
    const existing = this.operations.findRequest(profileId, request.requestKey)
    if (existing) {
      const previous = existing.operation.transfer
      const comparable = (r: typeof request) => r.direction === 'upload' ? { ...r, remotePath: undefined } : r
      if (previous?.version !== 2 || JSON.stringify(comparable(previous.request)) !== JSON.stringify(comparable(request))) throw new AppError('REQUEST_CONFLICT')
      return existing.operation
    }
    const spec: TransferSpec = { version: 2, request, accessRevision: a.revision, maxBytes: a.maxFileSizeMiB * 1024 * 1024, verification: a.verification, idleTimeoutMs: a.idleTimeoutSeconds * 1000, totalTimeoutMs: a.totalTimeoutMinutes * 60000 }
    this.check(a, spec)
    if (request.direction === 'upload') {
      // Only metadata before approval: no file content or hash is read or exposed yet.
      const stat = await fs.lstat(request.localPath!).catch(() => { throw new AppError('FILE_ACCESS') })
      if (!stat.isFile() || stat.isSymbolicLink()) throw new AppError('FILE_ACCESS')
      if (stat.size > spec.maxBytes) throw new AppError('FILE_LIMIT')
      spec.sourceSize = stat.size; spec.sourceIdentity = this.identity(stat)
    }
    if (this.access(profileId, request.serverId).revision !== a.revision) throw new AppError('FILE_CHANGED')
    guard()
    return this.operations.start(profileId, { serverId: request.serverId, requestKey: request.requestKey, command: `[SFTP ${request.direction}] ${request.remotePath}${request.localPath ? ` ↔ ${request.localPath}` : ''}`, cwd: '/', timeoutMs: request.direction === 'list' ? 30000 : 600000, connectTimeoutMs: 30000 }, undefined, spec)
  }
  private identity(s: import('node:fs').Stats) { return { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs } }
  private check(a: FileAccess, spec: TransferSpec): void {
    if (spec.version !== 2 || a.revision !== spec.accessRevision || spec.maxBytes !== a.maxFileSizeMiB * 1024 * 1024) throw new AppError('FILE_CHANGED')
    const r = spec.request
    if (r.direction === 'upload' && (!a.uploadEnabled || !r.remoteName || r.remotePath !== posix.join(a.uploadDirectory, r.remoteName))) throw new AppError('FILE_ACCESS')
    if ((r.expectedSize ?? 0) > spec.maxBytes || (spec.sourceSize ?? 0) > spec.maxBytes) throw new AppError('FILE_LIMIT')
  }
  private decision(profileId: string, spec: TransferSpec): PolicyDecision {
    const a = this.access(profileId, spec.request.serverId); this.check(a, spec)
    const p = this.operations.policy.get(), required = spec.request.direction === 'upload' ? p.uploadApprovalRequired?.[p.mode] : p.downloadApprovalRequired?.[p.mode]
    const action = p.mode === 'paused' ? 'deny' : required === false ? 'allow' : 'approval'
    return { revision: p.revision, mode: p.mode, action, matchedRules: [{ id: 'file-settings-v2', name: `服务器文件设置 v${a.revision}`, action }], reason: action === 'deny' ? '已暂停执行' : action === 'approval' ? '确认本次本机路径、远端路径和大小后传输；不覆盖、不执行' : '当前模式已关闭本方向文件审批，按用户授权传输并记录；保留固定上传目录、大小限制、不覆盖、不执行' }
  }
  private async localPath(path: string): Promise<string> {
    if (!isAbsolute(path)) throw new AppError('FILE_ACCESS')
    parse(localNameSchema, basename(path))
    try { return join(await fs.realpath(dirname(resolve(path))), basename(path)) } catch { throw new AppError('FILE_ACCESS') }
  }
  private async localRoot(root: string): Promise<string> {
    try { if (await fs.realpath(root) !== root || !(await fs.lstat(root)).isDirectory()) throw new Error(); return root } catch { throw new AppError('FILE_ACCESS') }
  }
  private async openSource(path: string) {
    await this.localRoot(dirname(path))
    if ((await fs.lstat(path)).isSymbolicLink() || await fs.realpath(path) !== path) throw new AppError('FILE_ACCESS')
    return fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  }
  private async remoteParent(sftp: SFTPWrapper, scope: ConnectionScope, path: string) {
    const parent = posix.dirname(path)
    if (await call<string>(scope, cb => sftp.realpath(parent, cb)) !== parent) throw new AppError('FILE_ACCESS')
  }
  private stagingDirectory(): Promise<string> {
    this.stagingReady ??= (async () => {
      const dbPath = this.operations.servers.store.path
      const path = dbPath === ':memory:' ? await fs.mkdtemp(join(tmpdir(), 'hostharbor-private-transfer-')) : join(dirname(dbPath), 'transfer-staging')
      await fs.mkdir(path, { recursive: true, mode: 0o700 })
      if (!(await fs.lstat(path)).isDirectory() || (await fs.lstat(path)).isSymbolicLink()) throw new AppError('FILE_ACCESS')
      const canonical = await fs.realpath(path)
      // One Core owns this private directory. Clean only its known regular
      // snapshot names from a previous interrupted process, never user files.
      for (const name of await fs.readdir(canonical)) if (/^[0-9a-f-]{36}\.part$/.test(name)) {
        const old = join(canonical, name); if ((await fs.lstat(old)).isFile()) await fs.unlink(old)
      }
      return canonical
    })()
    return this.stagingReady
  }
  async browse(profileId: string, raw: unknown, guard: () => void = () => {}): Promise<FileBrowseResult> {
    const input = parse(fileBrowseSchema, raw); input.remotePath = canonical(input.remotePath)
    const result = await this.operations.browseFiles(profileId, input)
    guard(); return result
  }
  private async browseRemote(client: import('ssh2').Client, scope: ConnectionScope, input: FileBrowseInput, verify: () => void): Promise<FileBrowseResult> {
    const sftp = scope.own(await call<SFTPWrapper>(scope, cb => client.sftp(cb)))
    verify()
    if (await call<string>(scope, cb => sftp.realpath(input.remotePath, cb)) !== input.remotePath) throw new AppError('FILE_ACCESS')
    const handle = await call<Buffer>(scope, cb => sftp.opendir(input.remotePath, cb))
    const entries: RemoteFile[] = []; let scanned = 0, nextOffset: number | null = null
    try { outer: for (;;) {
      verify()
      const batch = await call<import('ssh2').FileEntry[] | false>(scope, cb => sftp.readdir(handle, cb)).catch(e => { if (e?.code === 1) return false as const; throw e })
      if (!batch) break
      for (const entry of batch) {
        if (scanned >= 10000) throw new AppError('FILE_LIMIT')
        if (scanned++ < (input.offset ?? 0)) continue
        if (entries.length >= 100) { nextOffset = scanned - 1; break outer }
        if (entry.filename === '.' || entry.filename === '..' || entry.filename.length > 255 || /[\x00-\x1f\x7f/\\]/.test(entry.filename)) continue
        const stats = entry.attrs, mode = stats.mode & 0o170000
        entries.push({ name: entry.filename, kind: mode === 0o120000 ? 'symlink' : mode === 0o040000 ? 'directory' : mode === 0o100000 ? 'file' : 'other', size: stats.size, mtime: stats.mtime })
      }
    } } finally { await call(scope, cb => sftp.close(handle, cb)) }
    verify(); return { remotePath: input.remotePath, entries, nextOffset }
  }
  private async run(op: Operation, client: import('ssh2').Client, scope: ConnectionScope, progress: (r: TransferResult) => void, mutation: () => void, recheck: () => void): Promise<TransferResult> {
    const spec = op.transfer!, r = spec.request, MAX = spec.maxBytes
    const verify = () => { recheck(); this.check(this.access(op.profileId, op.serverId), spec) }
    let result: TransferResult = { startedAt: Date.now(), stageStartedAt: Date.now(), stageDurationsMs: {}, preparedBytes: 0, verifiedBytes: 0, verification: spec.verification ?? 'full', stage: 'preparing', publicationAttempted: false, bytes: 0, total: r.direction === 'upload' ? spec.sourceSize : r.expectedSize }
    const update = () => progress({ ...result })
    const stage = (value: NonNullable<TransferResult['stage']>) => { const now = Date.now(); result.stageDurationsMs![result.stage!] = (result.stageDurationsMs![result.stage!] ?? 0) + now - result.stageStartedAt!; result.stage = value; result.stageStartedAt = now; update() }
    try {
      update(); verify()
      const sftp = scope.own(await call<SFTPWrapper>(scope, cb => client.sftp(cb)))
      await this.remoteParent(sftp, scope, r.remotePath)
      const hash = createHash('sha256'), buffer = Buffer.alloc(65536)
      const remoteChunk = async (handle: Buffer, offset: number, length: number) => {
        const data = Buffer.alloc(length); let count = 0
        while (count < length) { verify(); const read = await call<number>(scope, cb => sftp.read(handle, data, count, length - count, offset + count, cb)); if (!read) throw new AppError('FILE_CHANGED'); count += read }
        return data
      }
      const localChunk = async (handle: Awaited<ReturnType<typeof fs.open>>, offset: number, length: number) => {
        const data = Buffer.alloc(length); let count = 0
        while (count < length) { verify(); const read = await handle.read(data, count, length - count, offset + count); if (!read.bytesRead) throw new AppError('FILE_CHANGED'); count += read.bytesRead }
        return data
      }
      let lastUpdate = 0
      const advance = (chunk: Buffer) => { result.bytes += chunk.length; if (result.bytes > MAX || result.bytes > result.total!) throw new AppError('FILE_CHANGED'); hash.update(chunk); if (Date.now() - lastUpdate > 250) { verify(); update(); lastUpdate = Date.now() } }
      if (r.direction === 'upload') {
        try { await call(scope, cb => sftp.lstat(r.remotePath, cb)); throw new AppError('FILE_EXISTS') } catch (e) { if (!missing(e)) throw e }
        const original = await this.openSource(r.localPath!)
        let remote: Buffer | undefined, source: Awaited<ReturnType<typeof fs.open>> | undefined, snapshotPath: string | undefined
        try {
          if (JSON.stringify(this.identity(await original.stat())) !== JSON.stringify(spec.sourceIdentity)) throw new AppError('FILE_CHANGED')
          snapshotPath = join(await this.stagingDirectory(), `${op.id}.part`)
          const snapshot = await fs.open(snapshotPath, 'wx', 0o600), snapshotHash = createHash('sha256'); let copied = 0
          try { for (;;) {
            verify(); const count = await original.read(buffer, 0, buffer.length, null); if (!count.bytesRead) break
            copied += count.bytesRead; if (copied > MAX || copied > spec.sourceSize!) throw new AppError('FILE_CHANGED')
            snapshotHash.update(buffer.subarray(0, count.bytesRead)); await snapshot.writeFile(buffer.subarray(0, count.bytesRead)); result.preparedBytes = copied; if (Date.now() - lastUpdate > 250) { update(); lastUpdate = Date.now() }
          } } finally { await snapshot.close() }
          if (copied !== spec.sourceSize || JSON.stringify(this.identity(await original.stat())) !== JSON.stringify(spec.sourceIdentity)) throw new AppError('FILE_CHANGED')
          const sourceHash = snapshotHash.digest('hex')
          source = await fs.open(snapshotPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
          result.tempPath = posix.join(posix.dirname(r.remotePath), `.hostharbor-${randomUUID()}.part`); update()
          stage('opening'); verify(); mutation()
          remote = await call<Buffer>(scope, cb => sftp.open(result.tempPath!, 'wx', { mode: 0o600 }, cb))
          stage('transferring')
          await filePipeline(spec.sourceSize!, async (offset, length) => {
            const data = await localChunk(source!, offset, length)
            verify(); await call(scope, cb => sftp.write(remote!, data, 0, data.length, offset, cb)); return data
          }, advance)
          await call(scope, cb => sftp.close(remote!, cb)); remote = undefined
          result.sha256 = hash.digest('hex')
          if (result.bytes !== spec.sourceSize || result.sha256 !== sourceHash) throw new AppError('FILE_CHANGED')
          stage('verifying')
          const remoteStats = await call<Stats>(scope, cb => sftp.lstat(result.tempPath!, cb))
          if (!remoteStats.isFile() || remoteStats.isSymbolicLink() || remoteStats.size !== result.bytes) throw new AppError('FILE_CHANGED')
          if (result.verification === 'full') {
            const checkHash = createHash('sha256'), read = await call<Buffer>(scope, cb => sftp.open(result.tempPath!, 'r', cb))
            try {
              await filePipeline(result.bytes, (offset, length) => remoteChunk(read, offset, length), data => {
                checkHash.update(data); result.verifiedBytes! += data.length
                if (Date.now() - lastUpdate > 250) { verify(); update(); lastUpdate = Date.now() }
              })
            } finally { await call(scope, cb => sftp.close(read, cb)) }
            const finalStats = await call<Stats>(scope, cb => sftp.lstat(result.tempPath!, cb))
            if (finalStats.size !== remoteStats.size || finalStats.mtime !== remoteStats.mtime || result.verifiedBytes !== result.bytes || checkHash.digest('hex') !== result.sha256) throw new AppError('FILE_CHANGED')
          }
          result.verificationComplete = true; update()
          verify(); await this.remoteParent(sftp, scope, r.remotePath); verify()
          // Standard SFTP v3 RENAME must fail if the destination exists. Never use
          // the OpenSSH overwrite-rename extension or delete an existing target.
          result.publicationAttempted = true; stage('publishing')
          await call(scope, cb => sftp.rename(result.tempPath!, r.remotePath, cb))
          result.published = true; result.tempPath = undefined; stage('completed'); return result
        } finally { await original.close(); await source?.close(); if (snapshotPath) await fs.unlink(snapshotPath).catch(() => {}); if (remote && !scope.controller.signal.aborted) await call(scope, cb => sftp.close(remote!, cb)).catch(() => {}) }
      }
      const destination = r.localPath!, root = await this.localRoot(dirname(destination))
      try { await fs.lstat(destination); throw new AppError('FILE_EXISTS') } catch (e) { if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) throw e }
      const sourceStats = await call<Stats>(scope, cb => sftp.lstat(r.remotePath, cb))
      if (!sourceStats.isFile() || sourceStats.isSymbolicLink() || (r.expectedSize !== undefined && sourceStats.size !== r.expectedSize) || (r.expectedMtime !== undefined && sourceStats.mtime !== r.expectedMtime)) throw new AppError('FILE_CHANGED')
      if (!Number.isSafeInteger(sourceStats.size) || sourceStats.size < 0 || !Number.isSafeInteger(sourceStats.mtime) || sourceStats.mtime < 0) throw new AppError('FILE_CHANGED')
      if (sourceStats.size > MAX) throw new AppError('FILE_LIMIT')
      result.total = sourceStats.size; update()
      if (await call<string>(scope, cb => sftp.realpath(r.remotePath, cb)) !== r.remotePath) throw new AppError('FILE_ACCESS')
      const remote = await call<Buffer>(scope, cb => sftp.open(r.remotePath, 'r', cb))
      result.tempPath = `.hostharbor-${randomUUID()}.part`; update(); const temporary = join(root, result.tempPath)
      let target: Awaited<ReturnType<typeof fs.open>> | undefined
      try {
        const stat = await call<Stats>(scope, cb => sftp.fstat(remote, cb))
        if (!stat.isFile() || stat.size !== sourceStats.size || stat.mtime !== sourceStats.mtime) throw new AppError('FILE_CHANGED')
        stage('opening'); verify(); mutation(); target = await fs.open(temporary, 'wx', 0o600)
        stage('transferring')
        await filePipeline(sourceStats.size, async (offset, length) => {
          const data = await remoteChunk(remote, offset, length); verify()
          let written = 0
          while (written < data.length) { const saved = await target!.write(data, written, data.length - written, offset + written); if (!saved.bytesWritten) throw new AppError('FILE_TRANSFER_FAILED'); written += saved.bytesWritten }
          return data
        }, advance)
        stage('verifying')
        const final = await call<Stats>(scope, cb => sftp.fstat(remote, cb))
        if (result.bytes !== sourceStats.size || final.size !== stat.size || final.mtime !== stat.mtime) throw new AppError('FILE_CHANGED')
        await target.sync(); await target.close(); target = undefined
        result.sha256 = hash.digest('hex'); result.verificationComplete = true; verify(); await this.localRoot(root); verify()
        // Hard-link publication is atomic and never replaces an existing destination.
        result.publicationAttempted = true; stage('publishing')
        await fs.link(temporary, destination); result.published = true; update()
        await fs.unlink(temporary); result.tempPath = undefined; stage('completed'); return result
      } finally { if (target) await target.close().catch(() => {}); if (!scope.controller.signal.aborted) await call(scope, cb => sftp.close(remote, cb)).catch(() => {}) }
    } catch (error) {
      // Keep only fixed local codes and numeric SFTP status, never server error text.
      const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      const sftpStatus = typeof rawCode === 'number' && Number.isInteger(rawCode) && rawCode >= 0 && rawCode <= 31 ? rawCode : undefined
      const failure = error instanceof AppError ? error : new AppError(sftpStatus === 3 ? 'FILE_PERMISSION_DENIED' : sftpStatus === 2 ? 'FILE_NOT_FOUND' : sftpStatus === 8 ? 'FILE_UNSUPPORTED' : 'FILE_TRANSFER_FAILED')
      result.failure = { code: failure.code, ...(sftpStatus !== undefined ? { sftpStatus } : {}) }
      if (!scope.controller.signal.aborted) update()
      throw failure
    }
  }
}
