import { inspectionChecks, inspectionDocumentSchema } from '../../shared/inspection'
import { createHash, randomUUID } from 'node:crypto'
import { constants, renameSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { dirname, join, isAbsolute } from 'node:path'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import type { BackupCounts, BackupItem, BackupPreview, BackupSelection, BackupImportResult } from '../../shared/backup'
import { dossierSchema, dossierCorrectionsSchema, type InvestigationView } from '../../shared/dossier'
import { applicationRecordSchema } from '../../shared/application'
import { fileSettingsSchema } from '../../shared/files'
import type { ServerService } from '../servers/service'
import type { OperationService } from '../operations/service'
import { parse } from '../validation'
import { encryptBackup, decryptBackup, maxBackupBytes } from './envelope'
import { validatePortable, type PortableBackup } from './schema'

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const lifetime = 10 * 60 * 1000
const identity = (s: import('node:fs').Stats) => JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs])
const filesKey = (id: string) => `files:settings:v2:${id}`
// Evidence output/operation references do not travel with asset backups.
function withoutEvidence<T>(input: T): T {
  return JSON.parse(JSON.stringify(input, (key, value) => key === 'evidenceIds' ? [] : key === 'confidence' && value === 'evidenced' ? 'unknown' : value)) as T
}
function canonical(value: unknown): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v
  return JSON.stringify(sorted(value))
}
function credentialValue(c: PortableBackup['credentials'][number]) { const { id: _id, ...value } = c; return canonical(value) }
function related(s: PortableBackup['servers'][number]) {
  const appReference = (id: string) => { const a = s.applications.find(a => a.id === id); return a ? hash(canonical([a.name,a.runtime,a.runtimeTarget,a.deploymentPath])) : id }
  const inspection = s.inspection ? { ...s.inspection, applicationIds: s.inspection.applicationIds.map(appReference).sort(), markdown: s.inspection.markdown.replace(/\{\{application:([a-f0-9-]{36})\}\}/g, (_all, id: string) => `{{application:${appReference(id)}}}`) } : undefined
  return canonical({ inspection, dossier: s.dossier, files: s.files && { ...s.files, serverId: undefined, revision: undefined }, applications: s.applications.map(a => ({ ...a, stale: a.serverRevision !== s.sourceRevision, id: undefined, serverId: undefined, serverRevision: undefined, revision: undefined, createdAt: undefined, updatedAt: undefined, confirmedAt: undefined, logSources: a.logSources.map(l => ({ ...l, id: undefined })) })) })
}
export function credentialDependencies(s: PortableBackup['servers'][number]): string[] {
  return [...new Set([s.credentialId, s.elevation.type === 'sudo' && s.elevation.passwordSource === 'credential' ? s.elevation.credentialId : null, s.route.type === 'socks5' && s.route.authentication.type === 'password' ? s.route.authentication.credentialId : null].filter((i): i is string => !!i))]
}
interface ImportSession { plain: Buffer; file: string; digest: string; stamp: string; expiresAt: number; preview: BackupPreview; guard: () => void; timer: NodeJS.Timeout }
export class BackupService {
  private session: ImportSession | undefined
  private epoch = 0
  private busy = false
  private readonly onInvalidated = (code: string) => { if (code === 'VAULT_LOCKED') this.clear() }
  constructor(private servers: ServerService, private operations: OperationService, private investigationBusy = () => false) { servers.invalidated.add(this.onInvalidated) }
  private get db() { return this.servers.store.db }
  clear(): void { this.epoch++; if (this.session) { clearTimeout(this.session.timer); this.session.plain.fill(0); this.session = undefined } }
  close(): void { this.clear(); this.servers.invalidated.delete(this.onInvalidated) }
  private async exclusive<T>(guard: () => void, run: (check: () => void) => Promise<T>): Promise<T> {
    if (this.busy) throw new AppError('BACKUP_BUSY')
    this.busy = true
    const epoch = this.epoch
    const check = () => { guard(); this.servers.assertUnlocked(); if (this.epoch !== epoch) throw new AppError('BACKUP_CHANGED') }
    try { check(); return await run(check) } finally { this.busy = false }
  }
  private decode(context: string, bytes: Uint8Array): unknown {
    const plain = this.servers.reveal(context, bytes)
    try { return JSON.parse(plain.toString()) } catch { throw new AppError('STORAGE_FAILED') } finally { plain.fill(0) }
  }
  summary(): BackupCounts {
    this.servers.assertUnlocked()
    const count = (table: string) => Number(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n)
    return { credentials: count('credentials'), servers: count('servers'), applications: count('applications'), dossiers: count('server_dossiers'), fileSettings: Number(this.db.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key LIKE 'files:settings:v2:%'").get()!.n) }
  }
  private snapshot(): PortableBackup {
    const counts = this.summary()
    if (counts.credentials > 2000 || counts.servers > 1000 || counts.applications > 40000) throw new AppError('BACKUP_LIMIT')
    const estimated = Number(this.db.prepare('SELECT COALESCE(SUM(length(secret)),0) AS n FROM credentials').get()!.n) + Number(this.db.prepare('SELECT COALESCE(SUM(length(detail)),0) AS n FROM server_dossiers').get()!.n) + Number(this.db.prepare('SELECT COALESCE(SUM(length(detail)),0) AS n FROM applications').get()!.n)
    if (estimated > maxBackupBytes) throw new AppError('BACKUP_LIMIT')
    const credentials = this.servers.listCredentials().map(c => this.servers.credentialForBackup(c.id))
    const servers = this.servers.listServers().map(record => {
      const { revision: _revision, createdAt: _createdAt, ...server } = record
      const row = this.db.prepare('SELECT detail FROM server_dossiers WHERE serverId=?').get(server.id)
      let dossier: PortableBackup['servers'][number]['dossier']
      if (row) {
        const view = this.decode(`server-dossier:${server.id}`, row.detail as Uint8Array) as InvestigationView
        if (view.report) dossier = { runId: view.report.runId, collectedAt: view.report.collectedAt, model: view.report.model, content: withoutEvidence(dossierSchema.parse(view.report.content)), ...(view.corrections ? { corrections: withoutEvidence(dossierCorrectionsSchema.parse(view.corrections)) } : {}) }
      }
      const applications = this.db.prepare('SELECT id,detail FROM applications WHERE serverId=? ORDER BY createdAt,id').all(server.id).map(a => withoutEvidence(applicationRecordSchema.parse(this.decode(`application:${a.id}`, a.detail as Uint8Array))))
      const file = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(filesKey(server.id))
      const planRow = this.db.prepare('SELECT revision,detail FROM inspection_plans WHERE serverId=? ORDER BY revision DESC LIMIT 1').get(server.id)
      const plan = planRow ? this.decode(`inspection-plan:${server.id}:${planRow.revision}`, planRow.detail as Uint8Array) as {title:string;markdown:string;applicationIds:string[]} : null
      const inspection = plan ? inspectionDocumentSchema.parse({title:plan.title,markdown:plan.markdown,applicationIds:plan.applicationIds.filter(id=>applications.some(a=>a.id===id))}) : undefined
      const files = file ? fileSettingsSchema.parse(this.decode(filesKey(server.id), file.value as Uint8Array)) : undefined
      return { ...server, sourceRevision: record.revision, applications, ...(inspection ? {inspection} : {}), ...(dossier ? { dossier } : {}), ...(files ? { files } : {}) }
    })
    const hosts = this.db.prepare('SELECT * FROM known_hosts ORDER BY host,port').all().filter(h => servers.some(s => s.host === h.host && s.port === h.port)).map(h => ({ host: String(h.host), port: Number(h.port), key: Buffer.from(h.key as Uint8Array).toString('base64'), fingerprint: String(h.fingerprint), confirmedAt: Number(h.confirmedAt) }))
    return validatePortable({ version: 1, createdAt: Date.now(), credentials, servers, hosts })
  }
  private stamp(): string {
    const digest = createHash('sha256')
    for (const table of ['credentials', 'servers', 'known_hosts', 'applications', 'server_dossiers', 'inspection_plans']) for (const row of this.db.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'known_hosts' ? 'host,port' : table === 'inspection_plans' ? 'serverId,revision' : table === 'server_dossiers' ? 'serverId' : 'id'}`).all()) digest.update(JSON.stringify(row))
    for (const row of this.db.prepare("SELECT * FROM metadata WHERE key LIKE 'files:settings:v2:%' ORDER BY key").all()) digest.update(JSON.stringify(row))
    return digest.digest('hex')
  }
  private async read(file: string): Promise<Buffer> {
    if (!isAbsolute(file)) throw new AppError('INVALID_INPUT')
    let handle: fs.FileHandle | undefined
    const parts: Buffer[] = []
    try {
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      const before = await handle.stat()
      if (!before.isFile()) throw new AppError('BACKUP_INVALID')
      if (before.size > maxBackupBytes) throw new AppError('BACKUP_LIMIT')
      let total = 0
      for (;;) {
        const part = Buffer.alloc(65536), { bytesRead } = await handle.read(part, 0, part.length, null)
        if (!bytesRead) break
        total += bytesRead; if (total > maxBackupBytes) throw new AppError('BACKUP_LIMIT')
        parts.push(part.subarray(0, bytesRead))
      }
      if (identity(before) !== identity(await handle.stat())) throw new AppError('BACKUP_CHANGED')
      return Buffer.concat(parts)
    } catch (error) { throw error instanceof AppError ? error : new AppError('BACKUP_INVALID') }
    finally { await handle?.close(); for (const p of parts) p.fill(0) }
  }
  async export(file: string, password: unknown, guard: () => void): Promise<BackupCounts> {
    return this.exclusive(guard, async check => {
      if (!isAbsolute(file)) throw new AppError('INVALID_INPUT')
      const data = this.snapshot(), counts = this.counts(data), plain = Buffer.from(JSON.stringify(data))
      let encrypted: Buffer | undefined, temporary: string | undefined
      try {
        encrypted = await encryptBackup(plain, password); check()
        const before = await fs.lstat(file).catch(e => { if (e.code === 'ENOENT') return undefined; throw e })
        if (before && (!before.isFile() || before.isSymbolicLink())) throw new AppError('BACKUP_CHANGED')
        temporary = join(dirname(file), `.hostharbor-backup-${randomUUID()}.tmp`)
        const handle = await fs.open(temporary, 'wx', 0o600)
        try { await handle.writeFile(encrypted); await handle.sync() } finally { await handle.close() }
        const current = await fs.lstat(file).catch(e => { if (e.code === 'ENOENT') return undefined; throw e })
        if ((before ? identity(before) : null) !== (current ? identity(current) : null)) throw new AppError('BACKUP_CHANGED')
        check(); renameSync(temporary, file); temporary = undefined
        return counts
      } catch (e) { throw e instanceof AppError ? e : new AppError('STORAGE_FAILED') }
      finally { plain.fill(0); encrypted?.fill(0); if (temporary) await fs.unlink(temporary).catch(() => {}) }
    })
  }
  private counts(p: PortableBackup): BackupCounts { return { credentials: p.credentials.length, servers: p.servers.length, applications: p.servers.reduce((n,s) => n+s.applications.length,0), dossiers: p.servers.filter(s => s.dossier).length, fileSettings: p.servers.filter(s => s.files).length } }
  private plan(p: PortableBackup) {
    const local = this.snapshot(), credentialMap = new Map<string, string>(), serverMap = new Map<string, string>(), items: BackupItem[] = []
    for (const c of p.credentials) {
      const same = local.credentials.find(l => credentialValue(c) === credentialValue(l))
      if (same) credentialMap.set(c.id, same.id)
      const status = same ? 'duplicate' : local.credentials.some(l => l.name === c.name) ? 'conflict' : 'new'
      items.push({ id: c.id, kind: 'credential', name: c.name, status, reason: status === 'conflict' ? 'name' : status, dependencies: [] })
    }
    for (const s of [...p.servers].sort((a,b) => Number(a.route.type === 'ssh-jump') - Number(b.route.type === 'ssh-jump'))) {
      const dependencies = [...credentialDependencies(s), ...(s.route.type === 'ssh-jump' ? [s.route.serverId] : [])]
      const pin = p.hosts.find(h => h.host === s.host && h.port === s.port), knownRow = this.servers.store.getHost(s.host, s.port), known = knownRow ? { key: Buffer.from(knownRow.key).toString('base64') } : undefined
      const hostConflict = pin && known && pin.key !== known.key
      const dependencyBlocked = dependencies.some(id => items.find(i => i.id === id)?.status === 'blocked')
      const route = s.route.type === 'ssh-jump' ? { ...s.route, serverId: serverMap.get(s.route.serverId) ?? `new:${s.route.serverId}` } : s.route.type === 'socks5' && s.route.authentication.type === 'password' ? { ...s.route, authentication: { ...s.route.authentication, credentialId: credentialMap.get(s.route.authentication.credentialId) ?? `new:${s.route.authentication.credentialId}` } } : s.route
      const elevation = s.elevation.type === 'sudo' && s.elevation.passwordSource === 'credential' ? { ...s.elevation, credentialId: credentialMap.get(s.elevation.credentialId!) ?? `new:${s.elevation.credentialId}` } : s.elevation
      const value = (x: typeof s | typeof local.servers[number], cid: unknown, r: unknown, e: unknown) => canonical({ name:x.name,host:x.host,port:x.port,username:x.username,credentialId:cid,route:r,elevation:e })
      const same = !hostConflict && !dependencyBlocked && local.servers.find(l => value(l,l.credentialId,l.route,l.elevation) === value(s,s.credentialId ? credentialMap.get(s.credentialId) ?? `new:${s.credentialId}` : null,route,elevation) && related(l) === related(s) && (pin?.key ?? null) === (known?.key ?? null))
      if (same) serverMap.set(s.id, same.id)
      const status = hostConflict || dependencyBlocked ? 'blocked' : same ? 'duplicate' : local.servers.some(l => l.name === s.name || (l.host === s.host && l.port === s.port && l.username === s.username)) ? 'conflict' : 'new'
      items.push({ id:s.id,kind:'server',name:s.name,detail:`${s.username}@${s.host}:${s.port}`,status,reason:hostConflict ? 'host-key' : dependencyBlocked ? 'dependency' : status === 'conflict' ? 'name' : status === 'duplicate' ? 'duplicate' : 'new',dependencies })
    }
    return { items, credentialMap, serverMap }
  }
  async preview(file: string, password: unknown, guard: () => void): Promise<BackupPreview> {
    if (this.busy) throw new AppError('BACKUP_BUSY')
    this.clear()
    return this.exclusive(guard, async check => {
      const bytes = await this.read(file)
      let plain: Buffer | undefined
      try {
        plain = await decryptBackup(bytes, password); check()
        let raw: unknown
        try { raw = JSON.parse(plain.toString()) } catch { throw new AppError('BACKUP_INVALID') }
        const data = validatePortable(raw), plan = this.plan(data), expiresAt = Date.now() + lifetime
        const preview: BackupPreview = { sessionId:randomUUID(),createdAt:data.createdAt,expiresAt,counts:this.counts(data),items:plan.items }
        check()
        const timer = setTimeout(() => this.clear(), lifetime); timer.unref()
        this.session = { plain, file, digest:hash(bytes), stamp:this.stamp(),expiresAt,preview,guard:check,timer }; plain = undefined
        return preview
      } finally { bytes.fill(0); plain?.fill(0) }
    })
  }
  async commit(raw: unknown, guard: () => void): Promise<BackupImportResult> {
    return this.exclusive(guard, async check => {
      const i: BackupSelection = parse(z.object({ sessionId:z.string().uuid(),servers:z.array(z.string().uuid()).max(1000),credentials:z.array(z.string().uuid()).max(2000) }).strict(),raw)
      const session = this.session
      if (!session || session.preview.sessionId !== i.sessionId) throw new AppError('BACKUP_SESSION')
      try {
        if (session.expiresAt <= Date.now()) throw new AppError('BACKUP_SESSION')
        session.guard(); const bytes = await this.read(session.file)
        try { if (hash(bytes) !== session.digest) throw new AppError('BACKUP_CHANGED') } finally { bytes.fill(0) }
        check(); session.guard()
        if (session.stamp !== this.stamp()) throw new AppError('BACKUP_CHANGED')
        this.operations.assertMaintenanceIdle(); if (this.investigationBusy()) throw new AppError('STORAGE_BUSY')
        const p = validatePortable(JSON.parse(session.plain.toString())), plan = this.plan(p)
        const selected = new Set([...i.servers,...i.credentials])
        if (!selected.size || i.servers.some(id => !plan.items.some(a => a.kind === 'server' && a.id === id)) || i.credentials.some(id => !plan.items.some(a => a.kind === 'credential' && a.id === id))) throw new AppError('INVALID_INPUT')
        for (const item of plan.items.filter(a => selected.has(a.id))) {
          if (item.status === 'blocked') throw new AppError('HOST_KEY_CHANGED')
          if (item.dependencies.some(id => !selected.has(id) && !plan.credentialMap.has(id) && !plan.serverMap.has(id))) throw new AppError('BACKUP_DEPENDENCY')
        }
        const result: BackupImportResult = {credentials:0,servers:0,skipped:0}, now=Date.now()
        this.db.exec('BEGIN IMMEDIATE')
        try {
          for (const c of p.credentials.filter(c => selected.has(c.id) && !plan.credentialMap.has(c.id))) {
            const {id,...input}=c; const saved=this.servers.saveCredential(input);plan.credentialMap.set(id,saved.id);result.credentials++
          }
          for (const s of [...p.servers].sort((a,b)=>Number(a.route.type==='ssh-jump')-Number(b.route.type==='ssh-jump')).filter(s=>selected.has(s.id)&&!plan.serverMap.has(s.id))) {
            const {id,sourceRevision,dossier,applications,files,inspection,...input}=s
            const route = input.route.type==='ssh-jump' ? {...input.route,serverId:plan.serverMap.get(input.route.serverId)!} : input.route.type==='socks5'&&input.route.authentication.type==='password' ? {...input.route,authentication:{...input.route.authentication,credentialId:plan.credentialMap.get(input.route.authentication.credentialId)!}} : input.route
            const elevation = input.elevation.type==='sudo'&&input.elevation.passwordSource==='credential' ? {...input.elevation,credentialId:plan.credentialMap.get(input.elevation.credentialId!)!} : input.elevation
            const saved=this.servers.saveServer({...input,credentialId:input.credentialId?plan.credentialMap.get(input.credentialId)!:null,route,elevation})
            plan.serverMap.set(id,saved.id);result.servers++
            if (dossier) this.saveDetail('server_dossiers',saved.id,`server-dossier:${saved.id}`,{run:null,report:{...dossier,corrections:undefined,serverRevision:saved.revision,snapshot:'restored-backup',evidence:[],restoredAt:now},...(dossier.corrections?{corrections:dossier.corrections}:{})})
            const applicationMap = new Map<string,string>()
            for (const a of applications) {
              const app={...a,id:randomUUID(),serverId:saved.id,serverRevision:a.serverRevision === sourceRevision ? saved.revision : saved.revision+1,revision:1,logSources:a.logSources.map(l=>({...l,id:randomUUID()}))}
              applicationMap.set(a.id,app.id)
              const data=Buffer.from(JSON.stringify(app));try {this.db.prepare('INSERT INTO applications(id,serverId,createdAt,detail) VALUES(?,?,?,?)').run(app.id,saved.id,a.createdAt,this.servers.protect(`application:${app.id}`,data))}finally{data.fill(0)}
            }
            if (inspection) {
              const doc = {title:inspection.title,markdown:inspection.markdown.replace(/\{\{application:([a-f0-9-]{36})\}\}/g, (all,id:string) => applicationMap.has(id)?`{{application:${applicationMap.get(id)}}}`:all),applicationIds:inspection.applicationIds.map(id=>applicationMap.get(id)!)}
              const plan = {...doc,serverId:saved.id,serverRevision:saved.revision,revision:1,updatedAt:now,contextDigest:'restored-backup',digest:hash(JSON.stringify(doc)),checks:inspectionChecks(doc.markdown),applicationRefs:doc.applicationIds.map(id=>({id,revision:1}))}
              const bytes=Buffer.from(JSON.stringify(plan));try{this.db.prepare('INSERT INTO inspection_plans(serverId,revision,detail) VALUES(?,1,?)').run(saved.id,this.servers.protect(`inspection-plan:${saved.id}:1`,bytes))}finally{bytes.fill(0)}
            }
            if(files){const key=filesKey(saved.id),data=Buffer.from(JSON.stringify({...files,serverId:saved.id,revision:1}));try{this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run(key,this.servers.protect(key,data))}finally{data.fill(0)}}
            const pin=p.hosts.find(h=>h.host===s.host&&h.port===s.port)
            if(pin&&!this.servers.store.getHost(pin.host,pin.port))this.db.prepare('INSERT INTO known_hosts(host,port,key,fingerprint,confirmedAt) VALUES(?,?,?,?,?)').run(pin.host,pin.port,Buffer.from(pin.key,'base64'),pin.fingerprint,pin.confirmedAt)
          }
          this.db.exec('COMMIT')
        }catch(error){this.db.exec('ROLLBACK');throw error}
        result.skipped=p.credentials.length+p.servers.length-result.credentials-result.servers
        return result
      } finally { this.clear() }
    })
  }
  private saveDetail(table: 'server_dossiers', id: string, context: string, value: unknown) {const bytes=Buffer.from(JSON.stringify(value));try{this.db.prepare(`INSERT INTO ${table}(serverId,detail) VALUES(?,?)`).run(id,this.servers.protect(context,bytes))}finally{bytes.fill(0)}}
}
