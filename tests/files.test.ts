import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { ServerService } from '../src/core/servers/service'
import { Store } from '../src/core/storage/database'
import { OperationService } from '../src/core/operations/service'
import { FileService } from '../src/core/files/service'
import { sshFixture, socksFixture } from './helpers/routes'
import { sftpFixture } from './helpers/sftp'
import type { Operation } from '../src/shared/contracts'
import { fileRequestSchema } from '../src/shared/files'
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture(options: Parameters<typeof sftpFixture>[0] = {}) {
  const ssh = await sftpFixture(options); cleanups.push(() => ssh.close())
  const servers = new ServerService(new Store(join(ssh.directory, 'vault.sqlite'))); servers.unlock(randomBytes(32))
  const credential = servers.saveCredential({ name: 'Synthetic file credential', kind: 'password', password: 'synthetic-file-password' })
  const server = servers.saveServer({ name: 'Synthetic SFTP server', host: '127.0.0.1', port: ssh.port, username: 'synthetic-file-user', credentialId: credential.id })
  const challenge = await servers.testConnection(server.id); if (challenge.status !== 'host-key-required') throw new Error('fixture challenge'); servers.trustHost(challenge.challengeId)
  const ops = new OperationService(servers), files = new FileService(ops)
  cleanups.push(() => { ops.close(); servers.close() })
  const profile = ops.createProfile({ name: 'Synthetic file agent', serverIds: [server.id], mode: 'policy', expiresAt: null }).profile
  ops.policy.save({ revision: 0, mode: 'assisted', rules: [] })
  const sendRoot = join(ssh.directory, 'send'), receiveRoot = join(ssh.directory, 'receive'); fs.mkdirSync(sendRoot); fs.mkdirSync(receiveRoot)
  const payload = randomBytes(140000); fs.writeFileSync(join(sendRoot, 'payload.bin'), payload)
  const access = files.save({ profileId: profile.id, serverId: server.id, revision: 0, uploadEnabled: true, uploadDirectory: '/srv/files', maxFileSizeMiB: 500 })
  const request = { serverId: server.id, requestKey: 'synthetic-upload', direction: 'upload' as const, remoteName: 'upload.bin', localPath: join(sendRoot, 'payload.bin') }

  return { ssh, servers, server, ops, files, profile, access, sendRoot, receiveRoot, payload, request }
}
const save = (a: import('../src/shared/files').FileAccess, profileId: string) => ({ ...a, profileId })
async function finish(ops: OperationService, id: string): Promise<Operation> { await vi.waitFor(() => expect(['succeeded', 'failed', 'unknown', 'interrupted']).toContain(ops.get(id).state), { timeout: 10000 }); return ops.get(id) }
describe('scoped SFTP operations', () => {
  it('reports an unavailable SFTP subsystem without halting the operation service', async () => {
    const f = await fixture({ rejectSftp: true })
    const op = await f.files.start(f.profile.id, f.request); f.ops.decide({ id: op.id, approve: true })
    const done = await finish(f.ops, op.id)
    expect(done.state).toBe('failed'); expect(done.errorCode).toBe('FILE_TRANSFER_FAILED')
    expect(done.fileResult).toMatchObject({ stage: 'preparing', publicationAttempted: false })
    expect((await f.files.start(f.profile.id, { ...f.request, requestKey: 'after-subsystem-refusal' })).state).toBe('awaiting_approval')
  })

  it('reports permission-denied temporary creation as failure before publication, without recording server text', async () => {
    const f = await fixture({ denyOpen: true })
    const pending = await f.files.start(f.profile.id, f.request)
    f.ops.decide({ id: pending.id, approve: true })
    const op = await finish(f.ops, pending.id)
    expect(op.state).toBe('failed'); expect(op.errorCode).toBe('FILE_PERMISSION_DENIED')
    expect(op.fileResult).toMatchObject({ stage: 'opening', bytes: 0, publicationAttempted: false, failure: { code: 'FILE_PERMISSION_DENIED', sftpStatus: 3 } })
    expect(f.ssh.writes).toBe(0); expect(fs.readdirSync(f.ssh.remoteRoot).some(n => n.endsWith('.part'))).toBe(false)
    expect(fs.existsSync(join(f.ssh.remoteRoot, 'upload.bin'))).toBe(false)
    expect((await f.files.start(f.profile.id, f.request)).id).toBe(op.id)
  })

  it.each(['all-approval', 'assisted', 'permissive', 'rules'] as const)('uses independent download consent in %s without changing upload approval', async mode => {
    const f = await fixture()
    fs.writeFileSync(join(f.ssh.remoteRoot, 'source.bin'), f.payload)
    f.ops.policy.save({ ...f.ops.policy.get(), mode, permissiveConfirmed: true, downloadApprovalRequired: { paused: false } })
    const request = { serverId: f.server.id, requestKey: 'manual-download', direction: 'download' as const, remotePath: '/srv/files/source.bin', localPath: join(f.receiveRoot, 'result.bin') }
    const manual = await f.files.start(f.profile.id, request)
    expect(manual.state).toBe('awaiting_approval')
    expect(f.files.describe(f.profile.id, f.server.id).downloadRequiresApproval).toBe(true)
    f.ops.policy.save({ ...f.ops.policy.get(), downloadApprovalRequired: { [mode]: false } })
    expect(f.ops.get(manual.id).state).toBe('interrupted')
    expect(fs.existsSync(request.localPath)).toBe(false)
    const op = await f.files.start(f.profile.id, { ...request, requestKey: 'automatic-download' })
    expect(op.state).not.toBe('awaiting_approval')
    const done = await finish(f.ops, op.id)
    expect(done.state).toBe('succeeded')
    expect(done.decision?.action).toBe('allow')
    expect(fs.readFileSync(request.localPath)).toEqual(f.payload)
    expect(f.files.describe(f.profile.id, f.server.id)).toMatchObject({ downloadRequiresApproval: false, uploadRequiresApproval: true, downloadsPaused: false })
    const duplicate = await f.files.start(f.profile.id, { ...request, requestKey: 'automatic-download' })
    expect(duplicate.id).toBe(op.id)
    expect((await f.files.start(f.profile.id, f.request)).state).toBe('awaiting_approval')
    const overwrite = await f.files.start(f.profile.id, { ...request, requestKey: 'no-overwrite' })
    expect((await finish(f.ops, overwrite.id)).errorCode).toBe('FILE_EXISTS')
    expect(fs.readFileSync(request.localPath)).toEqual(f.payload)
  })
  it.each(['all-approval', 'assisted', 'permissive', 'rules'] as const)('uses independent upload consent in %s while retaining default download approval and no overwrite', async mode => {
    const f = await fixture()
    f.ops.policy.save({ ...f.ops.policy.get(), mode, permissiveConfirmed: true })
    const manual = await f.files.start(f.profile.id, f.request)
    expect(manual.state).toBe('awaiting_approval'); expect(f.ssh.writes).toBe(0)
    f.ops.policy.save({ ...f.ops.policy.get(), uploadApprovalRequired: { [mode]: false } })
    expect(f.ops.get(manual.id).state).toBe('interrupted')
    const settings = f.files.describe(f.profile.id, f.server.id)
    expect(settings).toMatchObject({ uploadRequiresApproval: false, downloadRequiresApproval: true, uploadsPaused: false })
    const automatic = await f.files.start(f.profile.id, { ...f.request, requestKey: 'automatic-upload' })
    expect(automatic.state).not.toBe('awaiting_approval')
    const done = await finish(f.ops, automatic.id)
    expect(done.state).toBe('succeeded'); expect(done.intentAt).not.toBeNull(); expect(done.decision?.action).toBe('allow')
    expect(fs.readFileSync(join(f.ssh.remoteRoot, 'upload.bin'))).toEqual(f.payload)
    expect((await f.files.start(f.profile.id, { ...f.request, requestKey: 'automatic-upload' })).id).toBe(done.id)
    const overwrite = await f.files.start(f.profile.id, { ...f.request, requestKey: 'automatic-no-overwrite' })
    expect((await finish(f.ops, overwrite.id)).errorCode).toBe('FILE_EXISTS')
    expect(fs.readFileSync(join(f.ssh.remoteRoot, 'upload.bin'))).toEqual(f.payload)
    f.ops.policy.save({ ...f.ops.policy.get(), mode: mode === 'assisted' ? 'all-approval' : 'assisted' })
    expect(f.files.describe(f.profile.id, f.server.id).uploadRequiresApproval).toBe(true)
    expect(() => f.ops.policy.save({ ...f.ops.policy.get(), uploadApprovalRequired: { unknown: false } })).toThrow()
    expect(() => f.ops.policy.save({ ...f.ops.policy.get(), uploadApprovalRequired: { assisted: 'false' } })).toThrow()
  })
  it('enforces upload disablement, limits and pause even when upload approval is unchecked', async () => {
    const f = await fixture()
    f.ops.policy.save({ ...f.ops.policy.get(), uploadApprovalRequired: { assisted: false, paused: false } })
    const disabled = f.files.save({ ...save(f.access, f.profile.id), uploadEnabled: false })
    await expect(f.files.start(f.profile.id, f.request)).rejects.toMatchObject({ code: 'FILE_ACCESS' })
    f.files.save({ ...save(disabled, f.profile.id), uploadEnabled: true, maxFileSizeMiB: 1 })
    fs.writeFileSync(f.request.localPath, Buffer.alloc(1048577))
    await expect(f.files.start(f.profile.id, f.request)).rejects.toMatchObject({ code: 'FILE_LIMIT' })
    fs.writeFileSync(f.request.localPath, f.payload)
    f.ops.policy.save({ ...f.ops.policy.get(), mode: 'paused' })
    expect((await f.files.start(f.profile.id, f.request)).state).toBe('denied')
    expect(f.ssh.writes).toBe(0); expect(f.files.describe(f.profile.id, f.server.id).uploadsPaused).toBe(true)
  })
  it('checks actual size before reading even when download approval is disabled', async () => {
    const f = await fixture()
    f.files.save({ ...save(f.access, f.profile.id), maxFileSizeMiB: 1 })
    fs.writeFileSync(join(f.ssh.remoteRoot, 'large.bin'), Buffer.alloc(1048577))
    f.ops.policy.save({ ...f.ops.policy.get(), downloadApprovalRequired: { assisted: false } })
    const localPath = join(f.receiveRoot, 'large.bin')
    const op = await f.files.start(f.profile.id, { serverId: f.server.id, requestKey: 'automatic-size-limit', direction: 'download', remotePath: '/srv/files/large.bin', localPath })
    expect((await finish(f.ops, op.id)).errorCode).toBe('FILE_LIMIT')
    expect(f.ssh.reads).toBe(0); expect(fs.existsSync(localPath)).toBe(false)
  })
  it('keeps pause authoritative even when download approval is unchecked', async () => {
    const f = await fixture()
    f.ops.policy.save({ ...f.ops.policy.get(), mode: 'paused', downloadApprovalRequired: { paused: false } })
    const localPath = join(f.receiveRoot, 'blocked.bin')
    const op = await f.files.start(f.profile.id, { serverId: f.server.id, requestKey: 'paused-download', direction: 'download', remotePath: '/srv/files/source.bin', localPath })
    expect(op.state).toBe('denied'); expect(fs.existsSync(localPath)).toBe(false)
    expect(f.files.describe(f.profile.id, f.server.id).downloadsPaused).toBe(true)
    expect(() => f.ops.policy.save({ ...f.ops.policy.get(), downloadApprovalRequired: { assisted: 'false' } })).toThrow()
    expect(() => f.ops.policy.save({ ...f.ops.policy.get(), downloadApprovalRequired: { unknown: false } })).toThrow()
  })

  it('uses immutable approvals, uploads binary bytes with standard verification, lists pages and downloads without shell/content recordings', async () => {
    const f = await fixture()
    const upload = await f.files.start(f.profile.id, f.request)
    expect(upload.state).toBe('awaiting_approval'); expect(upload.intentAt).toBeNull(); expect(f.ssh.writes).toBe(0)
    f.ops.decide({ id: upload.id, approve: true })
    const done = await finish(f.ops, upload.id)
    expect(done.state).toBe('succeeded'); expect(done.agentGuidance?.nextAction).toBe('stop'); expect(done.fileResult?.published).toBe(true)
    expect(done.fileResult).toMatchObject({ verification: 'standard', verificationComplete: true, verifiedBytes: 0, stage: 'completed' }); expect(f.ssh.reads).toBe(0)
    expect(done.fileResult?.sha256).toBe(createHash('sha256').update(f.payload).digest('hex'))
    expect(fs.readFileSync(join(f.ssh.remoteRoot, 'upload.bin'))).toEqual(f.payload)
    expect(fs.readdirSync(join(f.ssh.directory, 'transfer-staging'))).toEqual([])
    const count = f.ops.history({}).total
    const listed = await f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/files/' })
    expect(f.ops.history({}).total).toBe(count)
    const entry = listed.entries.find(e => e.name === 'upload.bin')!
    const download = await f.files.start(f.profile.id, { serverId: f.server.id, requestKey: 'synthetic-download', direction: 'download', remotePath: '/srv/files/upload.bin', localPath: join(f.receiveRoot, 'received.bin'), expectedSize: entry.size, expectedMtime: entry.mtime })
    expect(download.state).toBe('awaiting_approval'); f.ops.decide({ id: download.id, approve: true })
    const received = await finish(f.ops, download.id); expect(received.state).toBe('succeeded'); expect(received.fileResult?.sha256).toBe(done.fileResult?.sha256)
    expect(fs.readFileSync(join(f.receiveRoot, 'received.bin'))).toEqual(f.payload)
    expect(f.ops.read(upload.id, 0).chunks).toEqual([]); expect(f.ssh.execs).toBe(0)
    expect(fs.readFileSync(join(f.ssh.directory, 'vault.sqlite')).includes(f.payload)).toBe(false)
    expect((await f.files.start(f.profile.id, f.request)).id).toBe(upload.id)
    await expect(f.files.start(f.profile.id, { ...f.request, remoteName: 'different.bin' })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' })
  })
  it('fully reads back a multi-batch upload and binds configured verification and timeouts to approval', async () => {
    const f = await fixture()
    const payload = randomBytes(1048576 + 123); fs.writeFileSync(f.request.localPath, payload)
    f.files.save({ ...save(f.access, f.profile.id), verification: 'full', idleTimeoutSeconds: 90, totalTimeoutMinutes: 60 })
    const op = await f.files.start(f.profile.id, f.request)
    expect(op.transfer).toMatchObject({ verification: 'full', idleTimeoutMs: 90000, totalTimeoutMs: 3600000 })
    expect(f.ssh.reads).toBe(0)
    f.ops.decide({ id: op.id, approve: true }); const done = await finish(f.ops, op.id)
    expect(done.state).toBe('succeeded')
    expect(done.fileResult).toMatchObject({ bytes: payload.length, verifiedBytes: payload.length, verification: 'full', verificationComplete: true, published: true, stage: 'completed' })
    expect(done.fileResult?.sha256).toBe(createHash('sha256').update(payload).digest('hex'))
    expect(f.ssh.reads).toBeGreaterThan(4)
    expect(fs.readFileSync(join(f.ssh.remoteRoot, 'upload.bin'))).toEqual(payload)
    expect(Object.keys(done.fileResult!.stageDurationsMs!)).toEqual(expect.arrayContaining(['preparing', 'transferring', 'verifying', 'publishing']))
  })
  it('rejects same-size content corruption during full readback before publication', async () => {
    let corrupt = () => {}
    const f = await fixture({ onFirstRead: () => corrupt() })
    f.files.save({ ...save(f.access, f.profile.id), verification: 'full' })
    const op = await f.files.start(f.profile.id, f.request)
    corrupt = () => {
      const temp = fs.readdirSync(f.ssh.remoteRoot).find(n => n.endsWith('.part'))!
      const fd = fs.openSync(join(f.ssh.remoteRoot, temp), 'r+'); fs.writeSync(fd, Buffer.from([f.payload[0] ^ 255]), 0, 1, 0); fs.closeSync(fd)
    }
    f.ops.decide({ id: op.id, approve: true }); const done = await finish(f.ops, op.id)
    expect(done.state).toBe('failed'); expect(done.errorCode).toBe('FILE_CHANGED')
    expect(done.fileResult).toMatchObject({ stage: 'verifying', publicationAttempted: false })
    expect(fs.existsSync(join(f.ssh.remoteRoot, 'upload.bin'))).toBe(false)
  })
  it.each(['idle', 'total'] as const)('records a distinct %s timeout without publishing or retrying', async kind => {
    const f = await fixture(kind === 'idle' ? { holdReads: true } : { holdWrites: true })
    if (kind === 'idle') f.files.save({ ...save(f.access, f.profile.id), verification: 'full' })
    const op = await f.files.start(f.profile.id, f.request)
    const realTimeout = globalThis.setTimeout
    // Accelerate only the configured file deadline; leave SSH, polling and authorization clocks intact.
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => realTimeout(callback, ms === (kind === 'idle' ? 120000 : 7200000) ? 500 : ms, ...args)) as typeof setTimeout)
    try {
      f.ops.decide({ id: op.id, approve: true }); const done = await finish(f.ops, op.id)
      expect(done.state).toBe('failed'); expect(done.errorCode).toBe(kind === 'idle' ? 'FILE_IDLE_TIMEOUT' : 'FILE_TOTAL_TIMEOUT')
      expect(done.fileResult).toMatchObject({ stage: kind === 'idle' ? 'verifying' : 'transferring', publicationAttempted: false })
      expect(fs.existsSync(join(f.ssh.remoteRoot, 'upload.bin'))).toBe(false)
      expect((await f.files.start(f.profile.id, f.request)).id).toBe(op.id)
      if (kind === 'idle') expect(done.fileResult?.bytes).toBe(f.payload.length)
    } finally { timer.mockRestore() }
  })
  it('shares only server settings, requires profile scope and does not enumerate local files', async () => {
    const f = await fixture(), other = f.ops.createProfile({ name: 'Synthetic other', serverIds: [f.server.id], mode: 'policy', expiresAt: null }).profile
    const pending = await f.files.start(other.id, { ...f.request, requestKey: 'other-profile' }); expect(pending.state).toBe('awaiting_approval'); expect(f.ssh.writes).toBe(0)
    await expect(f.files.start(f.profile.id, { ...f.request, remoteName: '../outside' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    fs.symlinkSync(join(f.sendRoot, 'payload.bin'), join(f.sendRoot, 'alias.bin'))
    await expect(f.files.start(f.profile.id, { ...f.request, localPath: join(f.sendRoot, 'alias.bin') })).rejects.toMatchObject({ code: 'FILE_ACCESS' })
    expect(JSON.stringify(f.files.describe(f.profile.id, f.server.id))).not.toContain(f.sendRoot)
    f.servers.lock(); expect(() => f.files.access(f.profile.id, f.server.id)).toThrow(expect.objectContaining({ code: 'VAULT_LOCKED' }))
  })
  it('refuses overwrite and changed source; preserves the existing remote file', async () => {
    const f = await fixture(); fs.writeFileSync(join(f.ssh.remoteRoot, 'upload.bin'), 'existing')
    const op = await f.files.start(f.profile.id, f.request); f.ops.decide({ id: op.id, approve: true })
    expect((await finish(f.ops, op.id)).errorCode).toBe('FILE_EXISTS'); expect(fs.readFileSync(join(f.ssh.remoteRoot, 'upload.bin'), 'utf8')).toBe('existing')
    const changed = await f.files.start(f.profile.id, { ...f.request, requestKey: 'changed', remoteName: 'new.bin' })
    fs.writeFileSync(join(f.sendRoot, 'payload.bin'), Buffer.alloc(f.payload.length, 42))
    f.ops.decide({ id: changed.id, approve: true }); const result = await finish(f.ops, changed.id)
    expect(result.errorCode).toBe('FILE_CHANGED'); expect(f.ssh.writes).toBe(0); expect(fs.existsSync(join(f.ssh.remoteRoot, 'new.bin'))).toBe(false)
  })
  it('invalidates every profile on server setting changes and always requires approval', async () => {
    const f = await fixture(), other = f.ops.createProfile({ name: 'Synthetic second profile', serverIds: [f.server.id], mode: 'policy', expiresAt: null }).profile
    const pending = await f.files.start(other.id, f.request)
    const changed = f.files.save({ ...save(f.access, f.profile.id), maxFileSizeMiB: 1 })
    expect(f.ops.get(pending.id).state).toBe('interrupted'); expect(() => f.ops.decide({ id: pending.id, approve: true })).toThrow()
    f.ops.policy.save({ ...f.ops.policy.get(), mode: 'permissive', permissiveConfirmed: true })
    const manual = await f.files.start(f.profile.id, { ...f.request, requestKey: 'still-manual' }); expect(manual.state).toBe('awaiting_approval')
    expect(() => f.files.save({ ...save(changed, f.profile.id), revision: 0 })).toThrow(expect.objectContaining({ code: 'FILE_CHANGED' }))
  })
  it('records failure before publication with temporary state and never auto-retries after revoke', async () => {
    const f = await fixture({ holdWrites: true }), pending = await f.files.start(f.profile.id, f.request)
    f.ops.decide({ id: pending.id, approve: true }); await vi.waitFor(() => expect(f.ops.get(pending.id).state).toBe('running'))
    f.ops.revokeProfile(f.profile.id)
    const op = await finish(f.ops, pending.id); expect(op.state).toBe('failed'); expect(op.fileResult?.tempPath).toBeTruthy()
    expect(fs.existsSync(join(f.ssh.remoteRoot, 'upload.bin'))).toBe(false)
    await expect(f.files.start(f.profile.id, { ...f.request, requestKey: 'after-revoke' })).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
  })
  it('holds all file work in all-approval and rejects new work while paused', async () => {
    const f = await fixture(); let p = f.ops.policy.save({ ...f.ops.policy.get(), mode: 'all-approval' })
    const count = f.ops.history({}).total
    const list = await f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/files' })
    expect(list.entries.length).toBeGreaterThan(0); expect(f.ops.history({}).total).toBe(count)
    f.ops.policy.save({ ...p, mode: 'paused' })
    await expect(f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/files' })).rejects.toMatchObject({ code: 'FILE_BROWSE_PAUSED' })
    const denied = await f.files.start(f.profile.id, f.request); expect(denied.state).toBe('denied'); expect(f.ssh.writes).toBe(0)
  })

  it('paginates remote directory entries and refuses remote/local symlinks, metadata changes and existing downloads', async () => {
    const f = await fixture()
    for (let n = 0; n < 123; n++) fs.writeFileSync(join(f.ssh.remoteRoot, `synthetic-${String(n).padStart(3, '0')}.txt`), 'fixture')
    fs.symlinkSync(join(f.ssh.remoteRoot, 'source.bin'), join(f.ssh.remoteRoot, 'alias.bin'))
    const page = await f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/files' })
    expect(page.entries).toHaveLength(100); expect(page.nextOffset).toBe(100)
    const pageTwo = await f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/files', offset: page.nextOffset! })
    expect(pageTwo.entries).toHaveLength(25); expect(new Set([...page.entries!, ...pageTwo.entries!].map(e => e.name)).size).toBe(125)
    const entry = page.entries!.find(e => e.name === 'source.bin')!
    const raw = { serverId: f.server.id, requestKey: 'existing-download', direction: 'download' as const, remotePath: '/srv/files/source.bin', localPath: join(f.receiveRoot, 'saved.bin'), expectedSize: entry.size, expectedMtime: entry.mtime }
    fs.writeFileSync(join(f.receiveRoot, 'saved.bin'), 'retained')
    const exists = await f.files.start(f.profile.id, raw); f.ops.decide({ id: exists.id, approve: true })
    expect((await finish(f.ops, exists.id)).errorCode).toBe('FILE_EXISTS'); expect(fs.readFileSync(join(f.receiveRoot, 'saved.bin'), 'utf8')).toBe('retained')
    const changed = await f.files.start(f.profile.id, { ...raw, requestKey: 'changed-download', localPath: join(f.receiveRoot, 'changed.bin'), expectedSize: 999 }); f.ops.decide({ id: changed.id, approve: true })
    expect((await finish(f.ops, changed.id)).errorCode).toBe('FILE_CHANGED')
    const alias = await f.files.start(f.profile.id, { ...raw, requestKey: 'symlink-download', localPath: join(f.receiveRoot, 'alias.bin'), remotePath: '/srv/files/alias.bin' }); f.ops.decide({ id: alias.id, approve: true })
    expect((await finish(f.ops, alias.id)).errorCode).toBe('FILE_CHANGED')
  })
  it('revokes local directory grants and enforces the size limit and no automatic publication retry', async () => {
    const f = await fixture({ failRename: true })
    const op = await f.files.start(f.profile.id, f.request); f.ops.decide({ id: op.id, approve: true })
    const failed = await finish(f.ops, op.id); expect(failed.state).toBe('unknown'); expect(failed.fileResult?.publicationAttempted).toBe(true); expect(failed.fileResult?.stage).toBe('publishing'); expect(failed.fileResult?.tempPath).toBeTruthy(); expect(failed.fileResult?.published).not.toBe(true)
    expect((await f.files.start(f.profile.id, f.request)).id).toBe(op.id)
    expect(fs.existsSync(join(f.ssh.remoteRoot, 'upload.bin'))).toBe(false)
    f.files.save({ ...save(f.access, f.profile.id), uploadEnabled: false, maxFileSizeMiB: 1 })
    await expect(f.files.start(f.profile.id, { ...f.request, requestKey: 'disabled-upload' })).rejects.toMatchObject({ code: 'FILE_ACCESS' })
    await expect(f.files.start(f.profile.id, { serverId: f.server.id, requestKey: 'too-large', direction: 'download', remotePath: '/srv/files/source.bin', localPath: join(f.receiveRoot, 'large.bin'), expectedSize: 1024 * 1024 + 1 })).rejects.toMatchObject({ code: 'FILE_LIMIT' })
  })
  it.each(['ssh-jump', 'socks5'] as const)('uses the same verified %s connection path for SFTP', async routeType => {
    const f = await fixture()
    let route: import('../src/shared/contracts').ServerRoute
    if (routeType === 'ssh-jump') {
      const jump = await sshFixture({ username: 'synthetic-jump', password: 'synthetic-jump-password', forwardPort: f.ssh.port }); cleanups.push(() => jump.close())
      const credential = f.servers.saveCredential({ name: 'Synthetic jump credential', kind: 'password', password: 'synthetic-jump-password' })
      const bastion = f.servers.saveServer({ name: 'Synthetic file jump', host: '127.0.0.1', port: jump.port, username: 'synthetic-jump', credentialId: credential.id })
      route = { type: 'ssh-jump', serverId: bastion.id }
    } else {
      const proxy = await socksFixture(f.ssh.port); cleanups.push(() => proxy.close()); route = { type: 'socks5', host: '127.0.0.1', port: proxy.port, authentication: { type: 'none' } }
    }
    f.servers.saveServer({ id: f.server.id, name: f.server.name, host: 'target.internal', port: f.server.port, username: f.server.username, credentialId: f.server.credentialId, route })
    for (let n = 0; n < 3; n++) { const connection = await f.servers.testConnection(f.server.id); if (connection.status === 'host-key-required') f.servers.trustHost(connection.challengeId); else break }
    const op = await f.files.start(f.profile.id, f.request); f.ops.decide({ id: op.id, approve: true })
    expect((await finish(f.ops, op.id)).state).toBe('succeeded'); expect(f.ssh.execs).toBe(0)
  })
  it('sends the approved private snapshot if the original changes during network upload', async () => {
    let mutate = () => {}
    const f = await fixture({ onFirstWrite: () => mutate() })
    const op = await f.files.start(f.profile.id, f.request)
    mutate = () => fs.writeFileSync(join(f.sendRoot, 'payload.bin'), Buffer.alloc(f.payload.length, 43))
    f.ops.decide({ id: op.id, approve: true })
    expect((await finish(f.ops, op.id)).state).toBe('succeeded')
    expect(fs.readFileSync(join(f.ssh.remoteRoot, 'upload.bin'))).toEqual(f.payload)
    expect(fs.readdirSync(join(f.ssh.directory, 'transfer-staging'))).toEqual([])
  })
  it.each(['../file', '/tmp/file', 'a/b', 'a\\b', 'C:secret', 'CON', 'file.', '..'])('rejects unsafe remote file name %s', remoteName => {
    expect(fileRequestSchema.safeParse({ serverId: '11111111-1111-4111-8111-111111111111', requestKey: 'fixture', direction: 'upload', remoteName, localPath: '/synthetic/source.bin' }).success).toBe(false)
  })
})

it('enforces configurable limits for preflight upload and unknown-size downloads without reading before approval', async () => {
  const f = await fixture()
  f.files.save({ ...save(f.access, f.profile.id), maxFileSizeMiB: 1 })
  fs.writeFileSync(join(f.sendRoot, 'large.bin'), Buffer.alloc(1024 * 1024 + 1))
  await expect(f.files.start(f.profile.id, { ...f.request, localPath: join(f.sendRoot, 'large.bin') })).rejects.toMatchObject({ code: 'FILE_LIMIT' })
  fs.writeFileSync(join(f.ssh.remoteRoot, 'large.bin'), Buffer.alloc(1024 * 1024 + 1))
  const localPath = join(f.receiveRoot, 'large.bin')
  const download = await f.files.start(f.profile.id, { serverId: f.server.id, requestKey: 'unknown-size', direction: 'download', remotePath: '/srv/files/large.bin', localPath })
  expect(download.state).toBe('awaiting_approval'); expect(fs.existsSync(localPath)).toBe(false)
  f.ops.decide({ id: download.id, approve: true })
  expect((await finish(f.ops, download.id)).errorCode).toBe('FILE_LIMIT'); expect(fs.existsSync(localPath)).toBe(false)
})
it('ignores legacy auto/root grants and rejects old configuration and tool arguments', async () => {
  const f = await fixture()
  const key = `files:access:${f.profile.id}:${f.server.id}`
  f.servers.store.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run(key, f.servers.protect(key, Buffer.from(JSON.stringify({ readRoots: ['/'], writeRoots: ['/'], autoUpload: true, autoDownload: true, sendRoot: f.sendRoot }))))
  const op = await f.files.start(f.profile.id, f.request)
  expect(op.state).toBe('awaiting_approval'); expect(op.transfer?.sourceHash).toBeUndefined()
  await expect(f.files.start(f.profile.id, { ...f.request, remotePath: '/other/file' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(() => f.files.save({ ...save(f.access, f.profile.id), autoUpload: true })).toThrow()
  const changed = f.files.save({ ...save(f.access, f.profile.id), uploadDirectory: '/srv/new' })
  expect(changed.uploadDirectory).toBe('/srv/new')
  const original = await f.files.start(f.profile.id, f.request); expect(original.id).toBe(op.id); expect(original.state).toBe('interrupted'); expect(original.transfer?.request.remotePath).toBe('/srv/files/upload.bin')
})
it.each([0, -1, 10241, 1.5])('rejects invalid server size setting %s', async maxFileSizeMiB => {
  const f = await fixture(); expect(() => f.files.save({ ...save(f.access, f.profile.id), maxFileSizeMiB })).toThrow()
})

it('never reads remote contents before approval and stops growth before writing excess bytes locally', async () => {
  let grow = () => {}
  const f = await fixture({ onFirstRead: () => grow() })
  grow = () => fs.appendFileSync(join(f.ssh.remoteRoot, 'source.bin'), Buffer.alloc(100))
  const localPath = join(f.receiveRoot, 'growth.bin')
  const op = await f.files.start(f.profile.id, { serverId: f.server.id, requestKey: 'growth', direction: 'download', remotePath: '/srv/files/source.bin', localPath })
  expect(f.ssh.reads).toBe(0); expect(fs.existsSync(localPath)).toBe(false)
  f.ops.decide({ id: op.id, approve: true }); const done = await finish(f.ops, op.id)
  expect(done.errorCode).toBe('FILE_CHANGED'); expect(fs.existsSync(localPath)).toBe(false)
  expect(fs.statSync(join(f.receiveRoot, done.fileResult!.tempPath!)).size).toBeLessThanOrEqual(7)
})

it('does not persist browse successes, failures, or obsolete list submissions', async () => {
  const f = await fixture(), count = f.ops.history({}).total
  await f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/files' })
  await expect(f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/missing' })).rejects.toThrow()
  await expect(f.files.start(f.profile.id, { serverId: f.server.id, requestKey: 'obsolete-list', direction: 'list', remotePath: '/srv/files' })).rejects.toMatchObject({ code: 'FILE_BROWSE_API' })
  expect(f.ops.history({}).total).toBe(count); expect(f.ssh.reads).toBe(0); expect(f.ssh.writes).toBe(0); expect(f.ssh.execs).toBe(0)
})
it.each(['revoke', 'lock', 'pause'] as const)('cancels a pending metadata browse on %s without an operation record', async cause => {
  let entered = false
  const f = await fixture({ holdListings: true, onListing: () => { entered = true } })
  const result = f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/files' }).then(() => null, e => e)
  await vi.waitFor(() => expect(entered).toBe(true))
  if (cause === 'revoke') f.ops.revokeProfile(f.profile.id)
  else if (cause === 'lock') f.servers.lock()
  else f.ops.policy.save({ ...f.ops.policy.get(), mode: 'paused' })
  expect(await result).toMatchObject({ code: cause === 'revoke' ? 'ACCESS_DENIED' : cause === 'lock' ? 'VAULT_LOCKED' : 'POLICY_CHANGED' })
  expect(f.servers.store.db.prepare('SELECT COUNT(*) n FROM operations').get()!.n).toBe(0)
})
it('paginates complete transfer history beyond the former 30-row limit and excludes legacy browse rows', async () => {
  const f = await fixture()
  for (let n = 0; n < 47; n++) {
    const op = await f.files.start(f.profile.id, { ...f.request, requestKey: `synthetic-page-${n}` })
    f.ops.decide({ id: op.id, approve: false })
    if (n === 0) {
      const row = f.servers.store.db.prepare('SELECT detail FROM operations WHERE id=?').get(op.id)!
      const bytes = f.servers.reveal(`${op.id}:detail`, row.detail as Uint8Array), detail = JSON.parse(bytes.toString()); bytes.fill(0)
      detail.transfer.request.direction = 'list'
      f.servers.store.db.prepare('UPDATE operations SET detail=? WHERE id=?').run(f.servers.protect(`${op.id}:detail`, Buffer.from(JSON.stringify(detail))), op.id)
    }
  }
  const query = { kind: 'file-transfer', serverId: f.server.id, pageSize: 20 }
  const pages = [0, 20, 40].map(offset => f.ops.history({ ...query, offset }))
  expect(pages.map(p => p.operations.length)).toEqual([20, 20, 6]); expect(pages.every(p => p.total === 46)).toBe(true)
  expect(new Set(pages.flatMap(p => p.operations.map(o => o.id))).size).toBe(46)
  expect(f.ops.history({ ...query, transferDirection: 'download' }).total).toBe(0)
})

it('shares the four-connection budget with transfers without creating browse records', async () => {
  let entered = 0
  const f = await fixture({ holdListings: true, onListing: () => { entered++ } })
  const pending = await f.files.start(f.profile.id, f.request)
  const reads = Array.from({ length: 4 }, () => f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/files' }).catch(e => e))
  await vi.waitFor(() => expect(entered).toBe(4))
  await expect(f.files.browse(f.profile.id, { serverId: f.server.id, remotePath: '/srv/files' })).rejects.toMatchObject({ code: 'OPERATION_LIMIT' })
  expect(() => f.ops.decide({ id: pending.id, approve: true })).toThrow(expect.objectContaining({ code: 'OPERATION_LIMIT' }))
  f.ops.revokeProfile(f.profile.id); await Promise.all(reads)
  expect(f.servers.store.db.prepare('SELECT COUNT(*) n FROM operations').get()!.n).toBe(1)
})
