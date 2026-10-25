import { Server, utils } from 'ssh2'
import * as fs from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
// Disposable real SSH/SFTP protocol fixture. No shell execution or production paths.
export async function sftpFixture(options: { holdReads?: boolean; holdWrites?: boolean; rejectSftp?: boolean; denyOpen?: boolean | (() => boolean); failRename?: boolean; onFirstWrite?: () => void; onFirstRead?: () => void; holdListings?: boolean; onListing?: () => void } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'hostharbor-sftp-'))), remoteRoot = join(directory, 'remote')
  fs.mkdirSync(remoteRoot); fs.writeFileSync(join(remoteRoot, 'source.bin'), Buffer.from([0, 1, 2, 255, 10, 0, 7]))
  const key = utils.generateKeyPairSync('ecdsa', { bits: 256 }).private
  const handles = new Map<string, { fd?: number; directory?: string[]; index?: number; path: string }>(), clients = new Set<{ end(): unknown }>()
  let id = 0, writes = 0, reads = 0, execs = 0
  const path = (remote: string) => { if (remote !== '/srv/files' && !remote.startsWith('/srv/files/')) throw new Error('outside fixture'); const p = resolve(remoteRoot, remote.slice('/srv/files'.length).replace(/^\//, '')); if (p !== remoteRoot && !p.startsWith(remoteRoot + sep)) throw new Error('outside fixture'); return p }
  const attrs = (stat: fs.Stats) => ({ mode: stat.mode, uid: stat.uid, gid: stat.gid, size: stat.size, atime: Math.floor(stat.atimeMs / 1000), mtime: Math.floor(stat.mtimeMs / 1000) })
  const server = new Server({ hostKeys: [key] }, client => {
    client.on('error', () => {})
    client.on('authentication', ctx => ctx.method === 'password' && ctx.username === 'synthetic-file-user' && ctx.password === 'synthetic-file-password' ? ctx.accept() : ctx.reject())
    client.on('session', accept => {
      const session = accept()
      session.on('exec', (_accept, reject) => { execs++; reject() })
      session.on('sftp', (accept, reject) => {
        if (options.rejectSftp) { reject(); return }
        const sftp = accept(); sftp.on('error', () => {})
        const handle = (key: Buffer) => { const h = handles.get(key.toString()); if (!h) throw new Error('bad handle'); return h }
        const safe = (req: number, job: () => void) => { try { job() } catch (e) { const code = (e as NodeJS.ErrnoException).code; sftp.status(req, code === 'ENOENT' ? 2 : code === 'EACCES' ? 3 : 4) } }
        sftp.on('REALPATH', (req, p) => safe(req, () => { const actual = fs.realpathSync(path(p)), rel = relative(remoteRoot, actual); sftp.name(req, [{ filename: rel.startsWith('..') ? '/outside-fixture' : '/srv/files' + (rel ? '/' + rel.split(sep).join('/') : ''), longname: '', attrs: attrs(fs.statSync(actual)) }]) }))
        for (const event of ['LSTAT', 'STAT'] as const) sftp.on(event, (req: number, p: string) => safe(req, () => sftp.attrs(req, attrs(event === 'LSTAT' ? fs.lstatSync(path(p)) : fs.statSync(path(p))))))
        sftp.on('OPEN', (req, p, flags, _attributes) => safe(req, () => {
          if ((typeof options.denyOpen === 'function' ? options.denyOpen() : options.denyOpen) && flags & 2) { sftp.status(req, 3); return }
          const name = String(++id), fd = fs.openSync(path(p), flags & 2 ? flags & 32 ? 'wx' : 'w' : 'r', 0o600)
          handles.set(name, { fd, path: path(p) }); sftp.handle(req, Buffer.from(name))
        }))
        sftp.on('FSTAT', (req, h) => safe(req, () => sftp.attrs(req, attrs(fs.fstatSync(handle(h).fd!)))))
        sftp.on('READ', (req, h, offset, length) => safe(req, () => { if (!reads++) options.onFirstRead?.(); if (options.holdReads) return; const data = Buffer.alloc(Math.min(length, 65536)), count = fs.readSync(handle(h).fd!, data, 0, data.length, offset); if (!count) sftp.status(req, 1); else sftp.data(req, data.subarray(0, count)) }))
        sftp.on('WRITE', (req, h, offset, data) => safe(req, () => { if (options.holdWrites) return; if (!writes) options.onFirstWrite?.(); fs.writeSync(handle(h).fd!, data, 0, data.length, offset); writes++; sftp.status(req, 0) }))
        sftp.on('CLOSE', (req, h) => safe(req, () => { const item = handle(h); if (item.fd !== undefined) fs.closeSync(item.fd); handles.delete(h.toString()); sftp.status(req, 0) }))
        sftp.on('RENAME', (req, from, to) => safe(req, () => { if (options.failRename) throw new Error('synthetic rename failure'); fs.linkSync(path(from), path(to)); fs.unlinkSync(path(from)); sftp.status(req, 0) }))
        sftp.on('OPENDIR', (req, p) => safe(req, () => { const name = String(++id), root = path(p); handles.set(name, { directory: fs.readdirSync(root), index: 0, path: root }); sftp.handle(req, Buffer.from(name)) }))
        sftp.on('READDIR', (req, h) => safe(req, () => { options.onListing?.(); if (options.holdListings) return; const item = handle(h), list = item.directory!.slice(item.index, (item.index ?? 0) + 17); item.index = (item.index ?? 0) + list.length; if (!list.length) { sftp.status(req, 1); return }; sftp.name(req, list.map(name => ({ filename: name, longname: name, attrs: attrs(fs.lstatSync(join(item.path, name))) }))) }))
      })
    })
  })
  server.on('connection', socket => { clients.add(socket); socket.on('close', () => clients.delete(socket)); socket.on('error', () => {}) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { directory, remoteRoot, port: (server.address() as AddressInfo).port, get writes() { return writes }, get reads() { return reads }, get execs() { return execs }, async close() {
    for (const client of clients) client.end()
    await new Promise<void>(resolve => server.close(() => resolve()))
    for (const item of handles.values()) if (item.fd !== undefined) { try { fs.closeSync(item.fd) } catch {} }
    fs.rmSync(directory, { recursive: true, force: true })
  } }
}
