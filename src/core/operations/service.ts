import { TransferDeadline } from '../files/deadlines'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { RecordingStore } from '../recording/storage'
import { PolicyService, evaluatePolicy } from '../policy/service'
import { SecretFilter } from './redaction'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import type { AccessProfile, CommandInput, Operation, OperationState, OutputPage, ServerRecord, PolicyDecision, ProfilePage } from '../../shared/contracts'
import { AppError, type ErrorCode } from '../../shared/errors'
import { idSchema, parse } from '../validation'
import type { ServerService } from '../servers/service'
import type { ClientChannel, Client } from 'ssh2'
import type { ConnectionScope } from '../ssh/connection'
import type { TransferSpec, TransferResult, FileBrowseInput, FileBrowseResult } from '../../shared/files'

import { terminalOperationStates } from '../../shared/operation-states'
import { normalizeElevation, sudoCommand, SudoConversation } from './sudo'
import { commandSchema } from '../../shared/mcp-tools'
import { logCommand } from '../applications/service'
import { sensitiveReviewInput, ApprovalReviewer } from '../policy/ai-review'
import type { AiService } from '../ai/service'
import { operationGuidance } from './guidance'
import { approvalLifetimeMs } from '../../shared/approval-timing'
import type { QueryScope } from '../policy/query-args'
import { parseQueryShell, QuerySyntaxError } from '../policy/query-shell'
export { commandSchema } from '../../shared/mcp-tools'
const profileSchema = z.object({ name: z.string().trim().min(1).max(100), serverIds: z.array(idSchema).min(1).max(100), mode: z.enum(['policy', 'confirm-each', 'time-limited']), expiresAt: z.number().int().safe().nullable() }).strict().refine(p => p.expiresAt !== null || p.mode !== 'time-limited')
const terminal = new Set<OperationState>(terminalOperationStates)
type Row = { id: string; profileId: string; requestKey: string; state: OperationState; detail: Uint8Array; result: Uint8Array | null; createdAt: number; updatedAt: number; intentAt: number | null; errorCode: ErrorCode | null; outputBytes: number; replayClearedAt: number | null; replayClearReason: string | null; decidedAt: number | null; humanDecision: string | null }
type Detail = Pick<Operation, 'input' | 'snapshot' | 'profileName' | 'serverName' | 'target' | 'dependencies' | 'routeServers' | 'decision'> & Pick<Operation, 'context' | 'profileRevision' | 'transfer'>
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
// Both arguments are quoted independently. This requires a POSIX sh on the remote host.
export function remoteCommand(input: CommandInput, marker: string): string {
  return `sh -c ${quote(`cd ${quote(input.cwd)} || exit 125; hh_cwd=$(pwd -P) || exit 125; printf '%s\\0%s\\0' ${quote(marker)} "$hh_cwd"; exec sh -c ${quote(input.command)}`)}`
}
export class OperationService {
  fileAdapter?: {
    browse(client: Client, scope: ConnectionScope, input: FileBrowseInput, recheck: () => void): Promise<FileBrowseResult>
    decision(profileId: string, spec: TransferSpec): PolicyDecision
    run(operation: Operation, client: Client, scope: ConnectionScope, progress: (result: TransferResult) => void, mutation: () => void, recheck: () => void): Promise<TransferResult>
  }
  private reviews = new Map<string, AbortController>()
  private reviewer?: ApprovalReviewer
  validateContext?: (context: NonNullable<Operation['context']>) => void
  queryScope?: (serverId: string) => Pick<QueryScope, 'logFiles' | 'revision'>
  private diagnosticScope(serverId: string, cwd: string): QueryScope {
    const server = this.servers.store.getServer(serverId)
    if (!server) throw new AppError('NOT_FOUND')
    return { ...this.queryScope?.(serverId), hosts: [server.host], cwd }
  }
  private protectQuerySecrets(decision: PolicyDecision, input: Pick<CommandInput, 'serverId' | 'command' | 'cwd'>): PolicyDecision {
    if ((!decision.queryPlan && !(decision.mode === 'permissive' && decision.action === 'allow')) || !this.servers.store.getServer(input.serverId)?.credentialId) return decision
    let words: string[]
    try { words = parseQueryShell(input.command, { patternWords: decision.mode === 'permissive' }).flatMap(p => p.commands.flatMap(c => c.words)) }
    catch (error) { if (decision.mode !== 'permissive' || !(error instanceof QuerySyntaxError)) throw error; words = input.command.split(/[^A-Za-z0-9_./:@+-]+/).filter(Boolean) }
    const values = this.servers.redactionValues(input.serverId)
    try {
      if (!values.some(value => value.length >= 4 ? input.command.includes(value) || input.cwd.includes(value) || words.some(word => word.includes(value)) : words.includes(value))) return decision
      return { ...decision, action: 'approval', queryPlan: undefined, matchedRules: [], reason: '查询包含已知敏感值，保留人工审批', ...(decision.queryAnalysis ? { queryAnalysis: { ...decision.queryAnalysis, issue: '查询包含已知敏感值，不能自动通过' } } : {}) }
    } finally { values.length = 0 }
  }
  private commandDecision(input: CommandInput, profileId: string, context?: Operation['context']): PolicyDecision {
    const decision = this.protectQuerySecrets(evaluatePolicy(this.policy.get(), { ...input, profileId, verifiedLogQuery: this.verifiedLog(input, context), queryScope: this.diagnosticScope(input.serverId, input.cwd) }), input)
    if (!input.elevation || decision.action === 'deny') return decision
    if (decision.mode === 'permissive') return { ...decision, reason: `${decision.reason}；以绑定凭证提权执行，遵循同一审批判断` }
    return { ...decision, action: 'approval', queryPlan: undefined, queryAnalysis: undefined, reason: '以 root 提权执行整条命令，需要人工批准' }
  }
  private browsing = new Map<string, { profileId: string; cancel: (code: ErrorCode) => void }>()
  private active = new Map<string, { cancel: (code: ErrorCode) => void; profileId: string }>()
  readonly recordings: RecordingStore
  readonly policy: PolicyService
  private readonly policyChanged = () => {
    this.abortReviews()
    for (const browse of this.browsing.values()) browse.cancel('POLICY_CHANGED')
    try {
      this.db.prepare("UPDATE operations SET state='interrupted',errorCode='POLICY_CHANGED',updatedAt=? WHERE intentAt IS NULL AND state IN ('awaiting_approval','queued','connecting')").run(Date.now())
      for (const [id, active] of this.active) if (this.row(id).intentAt === null) active.cancel('POLICY_CHANGED')
    } catch { this.halted = true; throw new AppError('STORAGE_FAILED') }
  }
  private halted = false
  private readonly invalidate = (code: ErrorCode) => {
    this.abortReviews()
    try { this.db.prepare("UPDATE operations SET state='interrupted', errorCode=?, updatedAt=? WHERE state IN ('awaiting_approval','queued')").run(code, Date.now()) }
    catch { this.halted = true }
    finally { for (const browse of this.browsing.values()) browse.cancel(code); for (const operation of this.active.values()) { try { operation.cancel(code) } catch { this.halted = true } } }
  }
  constructor(readonly servers: ServerService, ai?: AiService) {
    this.recordings = new RecordingStore(servers, () => this.active.size)
    this.policy = new PolicyService(servers, () => !!ai?.get().activeProvider)
    if (ai) this.reviewer = new ApprovalReviewer(ai)
    this.policy.changed.add(this.policyChanged)
    this.db.prepare("UPDATE operations SET state=CASE WHEN intentAt IS NULL THEN 'interrupted' ELSE 'unknown' END, updatedAt=? WHERE state NOT IN ('succeeded','failed','denied','interrupted','unknown','expired')").run(Date.now())
    this.db.prepare("UPDATE profiles SET revokedAt=? WHERE source='desktop-ai'").run(Date.now())
    servers.invalidated.add(this.invalidate)
  }
  private get db() { return this.servers.store.db }
  private protect(context: string, value: unknown): Buffer {
    const data = Buffer.from(JSON.stringify(value))
    try { return this.servers.protect(context, data) } finally { data.fill(0) }
  }
  private reveal<T>(context: string, value: Uint8Array): T {
    const data = this.servers.reveal(context, value)
    try { return JSON.parse(data.toString()) as T } finally { data.fill(0) }
  }
  listProfiles(includeDesktop = false): AccessProfile[] {
    this.servers.assertUnlocked()
    return this.db.prepare('SELECT id,name,serverIds,mode,expiresAt,revokedAt,deletedAt,createdAt,revision,(tokenSecret IS NOT NULL) AS hasSavedToken FROM profiles WHERE deletedAt IS NULL ORDER BY createdAt DESC,id').all().filter(row => includeDesktop || this.db.prepare('SELECT source FROM profiles WHERE id=?').get(row.id as string)?.source === 'mcp').map((row) => ({ ...row, hasSavedToken: !!row.hasSavedToken, serverIds: JSON.parse(row.serverIds as string), revokedAt: row.revokedAt ?? undefined, deletedAt: row.deletedAt ?? undefined })) as unknown as AccessProfile[]
  }
  queryProfiles(raw: unknown): ProfilePage {
    this.servers.assertUnlocked()
    const input = parse(z.object({ query: z.string().trim().max(100).optional(), status: z.enum(['available', 'all', 'active', 'expired', 'revoked', 'deleted']).default('available'), offset: z.number().int().min(0).max(1000000).default(0), pageSize: z.union([z.literal(20), z.literal(50), z.literal(100)]).default(20) }).strict(), raw)
    const now = Date.now(), query = (input.query ?? '').toLowerCase()
    const state = { available: 'p.deletedAt IS NULL', all: '1=1', deleted: 'p.deletedAt IS NOT NULL', revoked: 'p.deletedAt IS NULL AND p.revokedAt IS NOT NULL', expired: `p.deletedAt IS NULL AND p.revokedAt IS NULL AND p.expiresAt IS NOT NULL AND p.expiresAt<=${now}`, active: `p.deletedAt IS NULL AND p.revokedAt IS NULL AND (p.expiresAt IS NULL OR p.expiresAt>${now})` }[input.status]
    const where = `p.source='mcp' AND (${state}) AND (instr(lower(p.name),?)>0 OR EXISTS (SELECT 1 FROM json_each(p.serverIds) j JOIN servers s ON s.id=j.value WHERE instr(lower(s.name),?)>0 OR instr(lower(s.host),?)>0))`
    const total = Number(this.db.prepare(`SELECT count(*) AS n FROM profiles p WHERE ${where}`).get(query, query, query)!.n)
    const offset = Math.min(input.offset, Math.max(0, Math.ceil(total / input.pageSize) - 1) * input.pageSize)
    const rows = this.db.prepare(`SELECT p.id,p.name,p.serverIds,p.mode,p.expiresAt,p.revokedAt,p.deletedAt,p.createdAt,p.revision,(p.tokenSecret IS NOT NULL) AS hasSavedToken FROM profiles p WHERE ${where} ORDER BY p.createdAt DESC,p.id LIMIT ? OFFSET ?`).all(query, query, query, input.pageSize, offset)
    return { profiles: rows.map(row => ({ ...row, serverIds: JSON.parse(row.serverIds as string), hasSavedToken: !!row.hasSavedToken, revokedAt: row.revokedAt ?? undefined, deletedAt: row.deletedAt ?? undefined })) as unknown as AccessProfile[], total, offset, pageSize: input.pageSize }
  }
  deleteProfile(raw: unknown): void {
    this.servers.assertUnlocked()
    const input = parse(z.object({ id: idSchema, revision: z.number().int().positive() }).strict(), raw)
    const row = this.db.prepare("SELECT revision,deletedAt FROM profiles WHERE id=? AND source='mcp'").get(input.id)
    if (!row) throw new AppError('ACCESS_DENIED')
    if (row.deletedAt) return
    if (row.revision !== input.revision) throw new AppError('PROFILE_CONFLICT')
    const now = Date.now()
    this.changeProfile(input.id, () => {
      this.db.prepare('UPDATE profiles SET deletedAt=?,revokedAt=COALESCE(revokedAt,?),tokenSecret=NULL,revision=revision+1 WHERE id=? AND revision=?').run(now, now, input.id, input.revision)
    })
  }
  createProfile(raw: unknown): { profile: AccessProfile; token: string } {
    this.servers.assertUnlocked()
    const input = parse(profileSchema, raw), now = Date.now()
    if (input.expiresAt !== null && (input.expiresAt <= now || input.expiresAt > now + 86400000 * 30 || (input.mode === 'time-limited' && input.expiresAt > now + 3600000))) throw new AppError('INVALID_INPUT')
    if (this.listProfiles().length >= 100) throw new AppError('OPERATION_LIMIT')
    for (const id of input.serverIds) if (!this.servers.store.getServer(id)?.credentialId) throw new AppError('CREDENTIAL_REQUIRED')
    const token = randomBytes(32).toString('base64url'), id = randomUUID()
    const profile = { ...input, serverIds: [...new Set(input.serverIds)], id, createdAt: now, revision: 1, hasSavedToken: true }
    this.db.prepare('INSERT INTO profiles(id,name,tokenHash,serverIds,mode,expiresAt,createdAt,tokenSecret) VALUES(?,?,?,?,?,?,?,?)').run(id, input.name, createHash('sha256').update(token).digest('hex'), JSON.stringify(profile.serverIds), input.mode, input.expiresAt, now, this.protect(`profile-token:${id}`, token))
    return { profile, token }
  }
  private editableProfile(id: string, revision: number): AccessProfile {
    this.servers.assertUnlocked()
    const profile = this.listProfiles().find(p => p.id === id)
    if (!profile || profile.revokedAt) throw new AppError('ACCESS_DENIED')
    if (profile.revision !== revision) throw new AppError('PROFILE_CONFLICT')
    return profile
  }
  // Persist invalidation together with authorization changes. Never revive old requests.
  private changeProfile(id: string, write: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      write()
      this.db.prepare("UPDATE operations SET state='interrupted',errorCode='ACCESS_DENIED',updatedAt=? WHERE profileId=? AND intentAt IS NULL AND state IN ('awaiting_approval','queued','connecting')").run(Date.now(), id)
      this.db.exec('COMMIT')
    } catch { this.db.exec('ROLLBACK'); throw new AppError('STORAGE_FAILED') }
    try { for (const item of this.active.values()) if (item.profileId === id) item.cancel('ACCESS_DENIED') }
    catch { this.halted = true; throw new AppError('STORAGE_FAILED') }
    for (const browse of this.browsing.values()) if (browse.profileId === id) browse.cancel('ACCESS_DENIED')
    this.abortProfileReviews(id)
  }
  updateProfile(raw: unknown): AccessProfile {
    const input = parse(z.object({ id: idSchema, revision: z.number().int().positive(), name: z.string().trim().min(1).max(100), serverIds: z.array(idSchema).min(1).max(100), expiresAt: z.number().int().safe().nullable() }).strict(), raw)
    const old = this.editableProfile(input.id, input.revision), now = Date.now()
    // Unchanged deadlines stay exact; editing the name never extends the grant.
    if (input.expiresAt !== old.expiresAt && input.expiresAt !== null && (input.expiresAt <= now || input.expiresAt > now + 30 * 86400000)) throw new AppError('INVALID_INPUT')
    for (const id of input.serverIds) if (!this.servers.store.getServer(id)?.credentialId) throw new AppError('CREDENTIAL_REQUIRED')
    const serverIds = [...new Set(input.serverIds)]
    if (old.name === input.name && JSON.stringify(old.serverIds) === JSON.stringify(serverIds) && old.expiresAt === input.expiresAt) return old
    this.changeProfile(input.id, () => {
      // All execution now follows global policy; editing upgrades legacy modes explicitly.
      this.db.prepare("UPDATE profiles SET name=?,serverIds=?,expiresAt=?,mode='policy',revision=revision+1 WHERE id=? AND revision=?").run(input.name, JSON.stringify(serverIds), input.expiresAt, input.id, input.revision)
    })
    return this.listProfiles().find(p => p.id === input.id)!
  }
  prepareProfileToken(raw: unknown): void {
    const input = parse(z.object({ id: idSchema, revision: z.number().int().positive(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(), regenerate: z.literal(true).optional() }).strict().refine(i => !!i.token !== !!i.regenerate), raw)
    const profile = this.editableProfile(input.id, input.revision)
    this.profile(profile.id) // No token export/rotation for expired or revoked access.
    if (input.token) {
      const hash = this.db.prepare('SELECT tokenHash FROM profiles WHERE id=?').get(profile.id)!.tokenHash
      if (createHash('sha256').update(input.token).digest('hex') !== hash) throw new AppError('ACCESS_DENIED')
      this.db.prepare('UPDATE profiles SET tokenSecret=? WHERE id=? AND revision=?').run(this.protect(`profile-token:${profile.id}`, input.token), profile.id, input.revision)
    } else {
      const token = randomBytes(32).toString('base64url')
      const encrypted = this.protect(`profile-token:${profile.id}`, token)
      this.changeProfile(profile.id, () => {
        this.db.prepare('UPDATE profiles SET tokenHash=?,tokenSecret=?,revision=revision+1 WHERE id=? AND revision=?').run(createHash('sha256').update(token).digest('hex'), encrypted, profile.id, input.revision)
      })
    }
  }
  // Main-only RPC. Never returned through renderer IPC or registered as an MCP tool.
  installationProfile(raw: unknown): { name: string; token: string } {
    const profile = this.profile(parse(idSchema, raw))
    const row = this.db.prepare("SELECT tokenSecret,tokenHash FROM profiles WHERE id=? AND source='mcp'").get(profile.id)
    if (!row) throw new AppError('ACCESS_DENIED')
    if (!(row.tokenSecret instanceof Uint8Array)) throw new AppError('PROFILE_TOKEN_REQUIRED')
    const token = this.reveal<unknown>(`profile-token:${profile.id}`, row.tokenSecret)
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || createHash('sha256').update(token).digest('hex') !== row.tokenHash) throw new AppError('STORAGE_FAILED')
    return { name: profile.name, token }
  }
  revokeProfile(raw: unknown): void {
    this.servers.assertUnlocked()
    const id = parse(idSchema, raw)
    this.db.prepare('UPDATE profiles SET revokedAt=? WHERE id=?').run(Date.now(), id)
    this.db.prepare("UPDATE operations SET state='interrupted',errorCode='ACCESS_DENIED',updatedAt=? WHERE profileId=? AND state IN ('awaiting_approval','queued')").run(Date.now(), id)
    for (const item of this.active.values()) if (item.profileId === id) item.cancel('ACCESS_DENIED')
    for (const browse of this.browsing.values()) if (browse.profileId === id) browse.cancel('ACCESS_DENIED')
    this.abortProfileReviews(id)
  }
  invalidateFileAccess(profileId: string | undefined, serverId: string): void {
    for (const row of this.db.prepare("SELECT * FROM operations WHERE (? IS NULL OR profileId=?) AND state IN ('awaiting_approval','queued','connecting','dispatching','running')").all(profileId ?? null, profileId ?? null) as Row[]) {
      const op = this.view(row); if (op.serverId !== serverId || !op.transfer) continue
      if (!terminal.has(op.state)) { this.active.get(op.id)?.cancel('FILE_CHANGED'); if (op.intentAt === null) this.state(op.id, 'interrupted', 'FILE_CHANGED') }
    }
  }
  // Called only by the desktop investigation service after an explicit UI start.
  // No usable MCP token is created; authenticate() rejects this source independently.
  desktopProfile(serverId: string, purpose: 'desktop-ai' | 'desktop-files' = 'desktop-ai'): string {
    this.servers.assertUnlocked(); this.snapshot(serverId)
    const scope = JSON.stringify([serverId]), now = Date.now()
    const old = this.db.prepare("SELECT id FROM profiles WHERE source=? AND serverIds=?").get(purpose, scope)
    const id = old?.id as string | undefined ?? randomUUID()
    if (old) this.db.prepare('UPDATE profiles SET expiresAt=?,revokedAt=NULL WHERE id=?').run(now + 600000, id)
    else this.db.prepare("INSERT INTO profiles(id,name,tokenHash,serverIds,mode,expiresAt,createdAt,source) VALUES(?,?,?,?,?,?,?,?)").run(id, purpose === 'desktop-files' ? '桌面文件传输' : '桌面 AI 调查', createHash('sha256').update(randomBytes(32)).digest('hex'), scope, 'policy', now + 600000, now, purpose)
    return id
  }
  releaseDesktopProfile(id: string) {
    this.db.prepare("UPDATE profiles SET revokedAt=? WHERE id=? AND source='desktop-ai'").run(Date.now(), id)
    for (const item of this.active.values()) if (item.profileId === id) item.cancel('ACCESS_DENIED')
  }
  authenticate(token: string): string {
    if (token.length !== 43) throw new AppError('ACCESS_DENIED')
    const row = this.db.prepare('SELECT id,expiresAt,revokedAt,source FROM profiles WHERE tokenHash=?').get(createHash('sha256').update(token).digest('hex'))
    if (!row || row.source !== 'mcp' || row.revokedAt || (row.expiresAt !== null && Number(row.expiresAt) <= Date.now())) throw new AppError('ACCESS_DENIED')
    return row.id as string
  }
  private profile(id: string, serverId?: string): AccessProfile {
    this.servers.assertUnlocked()
    const profile = this.listProfiles(true).find((p) => p.id === id)
    if (!profile || !profileSchema.safeParse({ name: profile.name, serverIds: profile.serverIds, mode: profile.mode, expiresAt: profile.expiresAt }).success || profile.revokedAt || (profile.expiresAt !== null && profile.expiresAt <= Date.now()) || (serverId && !profile.serverIds.includes(serverId))) throw new AppError('ACCESS_DENIED')
    return profile
  }
  assertServerAccess(profileId: string, serverId: string): void { this.profile(profileId, serverId) }
  findRequest(profileId: string, requestKey: string): { operation: Operation; context: unknown } | null {
    this.profile(profileId)
    if (this.db.prepare('SELECT requestKey FROM operation_tombstones WHERE profileId=? AND requestKey=?').get(profileId, requestKey)) throw new AppError('OPERATION_REMOVED')
    const row = this.db.prepare('SELECT * FROM operations WHERE profileId=? AND requestKey=?').get(profileId, requestKey) as Row | undefined
    return row ? { operation: this.get(row.id, profileId), context: this.reveal<Detail>(`${row.id}:detail`, row.detail).context } : null
  }
  listServers(profileId: string) {
    const profile = this.profile(profileId)
    return this.servers.listServers().filter((s) => profile.serverIds.includes(s.id)).map(({ id, name, host, port, username, elevation }) => ({ id, name, host, port, username, sudoConfigured: elevation?.type === 'sudo' }))
  }
  snapshot(serverId: string): { snapshot: string; routeServers: ServerRecord[]; target: ServerRecord; dependencies: Detail['dependencies'] } {
    const server = this.servers.store.getServer(serverId)
    if (!server) throw new AppError('NOT_FOUND')
    const list = [server]
    if (server.route.type === 'ssh-jump') {
      const jump = this.servers.store.getServer(server.route.serverId)
      if (!jump || jump.route.type !== 'direct') throw new AppError('ROUTE_INVALID')
      list.push(jump)
    }
    const credentialIds = list.map((s) => s.credentialId)
    if (server.elevation?.type === 'sudo' && server.elevation.passwordSource === 'credential') credentialIds.push(server.elevation.credentialId!)
    if (server.route.type === 'socks5' && server.route.authentication.type === 'password') credentialIds.push(server.route.authentication.credentialId)
    const dependencies = credentialIds.map((id) => {
      const credential = id ? this.servers.store.getCredential(id) : undefined
      if (!credential) throw new AppError('CREDENTIAL_REQUIRED')
      return { id: credential.id, name: credential.name, revision: credential.revision }
    })
    const hosts = list.map((s) => { const host = this.servers.store.getHost(s.host, s.port); if (!host) throw new AppError('HOST_KEY_REQUIRED'); return { host: s.host, port: s.port, key: Buffer.from(host.key).toString('base64') } })
    return { snapshot: createHash('sha256').update(JSON.stringify({ list, dependencies, hosts })).digest('hex'), routeServers: list, target: server, dependencies }
  }
  async browseFiles(profileId: string, input: FileBrowseInput): Promise<FileBrowseResult> {
    const profile = this.profile(profileId, input.serverId), snapshot = this.snapshot(input.serverId).snapshot, policyRevision = this.policy.get().revision
    if (this.policy.get().mode === 'paused') throw new AppError('FILE_BROWSE_PAUSED')
    if (!this.fileAdapter || this.active.size + this.browsing.size >= 4) throw new AppError('OPERATION_LIMIT')
    const id = randomUUID()
    let timer: ReturnType<typeof setTimeout> | undefined, expiry: ReturnType<typeof setTimeout> | undefined
    const verify = () => {
      const current = this.profile(profileId, input.serverId)
      if (current.revision !== profile.revision) throw new AppError('ACCESS_DENIED')
      if (this.snapshot(input.serverId).snapshot !== snapshot) throw new AppError('CONFIG_CHANGED')
      if (this.policy.get().revision !== policyRevision) throw new AppError('POLICY_CHANGED')
    }
    this.browsing.set(id, { profileId, cancel: () => {} })
    try {
      return await this.servers.withConnection(input.serverId, async (client, scope) => {
        verify()
        const result = await this.fileAdapter!.browse(client, scope, input, () => { scope.controller.signal.throwIfAborted(); verify() })
        verify(); return result
      }, true, 30000, scope => {
        this.browsing.set(id, { profileId, cancel: code => scope.fail(new AppError(code)) })
        timer = setTimeout(() => scope.fail(new AppError('CONNECTION_TIMEOUT')), 30000)
        if (profile.expiresAt !== null) expiry = setTimeout(() => scope.fail(new AppError('ACCESS_DENIED')), Math.min(2147483647, Math.max(1, profile.expiresAt - Date.now())))
      })
    } catch (error) { throw error instanceof AppError ? error : new AppError('FILE_TRANSFER_FAILED') }
    finally { clearTimeout(timer); clearTimeout(expiry); this.browsing.delete(id) }
  }
  start(profileId: string, raw: unknown, context?: Operation['context'], transfer?: TransferSpec): Operation {
    const input = parse(commandSchema, raw)
    if (normalizeElevation(input).elevation) input.elevation = 'sudo'
    const profile = this.profile(profileId, input.serverId)
    if (this.db.prepare('SELECT requestKey FROM operation_tombstones WHERE profileId=? AND requestKey=?').get(profileId, input.requestKey)) throw new AppError('OPERATION_REMOVED')
    const existing = this.db.prepare('SELECT * FROM operations WHERE profileId=? AND requestKey=?').get(profileId, input.requestKey) as Row | undefined
    if (existing) {
      const operation = this.view(existing)
      if (JSON.stringify(operation.input) !== JSON.stringify(input) || JSON.stringify(operation.transfer) !== JSON.stringify(transfer)) throw new AppError('REQUEST_CONFLICT')
      return this.get(existing.id, profileId)
    }
    if (input.elevation) { const password = this.servers.elevationPassword(input.serverId); password?.fill(0) }
    this.recordings.maintain()
    if (this.halted || this.active.size + this.browsing.size >= 4 || Number(this.db.prepare('SELECT COUNT(*) AS count FROM operations').get()!.count) >= 10000 || Number(this.db.prepare("SELECT COUNT(*) AS count FROM operations WHERE state='awaiting_approval'").get()!.count) >= 20) throw new AppError('OPERATION_LIMIT')
    const policy = this.policy.get()
    const decision = transfer ? this.fileAdapter!.decision(profileId, transfer) : this.commandDecision(input, profileId, context)
    const review = !transfer && !input.elevation && policy.mode === 'assisted' && policy.aiAssist && decision.action === 'approval' && !decision.matchedRules.length
    if (review) decision.aiReview = { status: 'pending', reason: 'AI 正在分析；你也可以直接人工决定' }
    const id = randomUUID(), now = Date.now(), state = decision.action === 'deny' ? 'denied' : decision.action === 'approval' ? 'awaiting_approval' : 'queued'
    const detail: Detail = { context, transfer, profileRevision: profile.revision, decision, input, ...this.snapshot(input.serverId), profileName: profile.name, serverName: this.servers.store.getServer(input.serverId)!.name }
    this.db.prepare('INSERT INTO operations(id,profileId,requestKey,state,detail,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run(id, profileId, input.requestKey, state, this.protect(`${id}:detail`, detail), now, now)
    if (state === 'queued') this.schedule(id)
    else if (review) this.startReview(id)
    return this.get(id, profileId)
  }
  previewPolicy(raw: unknown) {
    const input = parse(commandSchema.omit({ requestKey: true, timeoutMs: true, connectTimeoutMs: true }).extend({ profileId: idSchema }), raw)
    this.profile(input.profileId, input.serverId)
    const normalized = normalizeElevation({ ...input, requestKey: 'preview', timeoutMs: 60000, connectTimeoutMs: 30000 })
    return this.commandDecision({ ...normalized, command: input.command }, input.profileId)
  }
  private row(id: string): Row { const row = this.db.prepare('SELECT * FROM operations WHERE id=?').get(parse(idSchema, id)) as Row | undefined; if (!row) throw new AppError('NOT_FOUND'); return row }
  private verifiedLog(input: CommandInput, context?: Operation['context']): boolean {
    if (!context) return false
    if (!this.validateContext) throw new AppError('CONTEXT_CHANGED')
    this.validateContext(context)
    if (context.query.serverId !== input.serverId || context.query.requestKey !== input.requestKey || input.command !== logCommand(context.source, context.query)) throw new AppError('CONTEXT_CHANGED')
    return !sensitiveReviewInput(input.command)
  }
  private abortProfileReviews(profileId: string) {
    for (const [id, controller] of this.reviews) if (this.row(id).profileId === profileId) controller.abort()
  }
  private abortReviews() { for (const controller of this.reviews.values()) controller.abort(); this.reviews.clear() }
  private startReview(id: string) {
    const controller = new AbortController(); this.reviews.set(id, controller)
    // Durable before inference; no SSH, no retries and no AI-only allow.
    void (async () => {
      const timer = setTimeout(() => controller.abort(), 12000)
      const secrets: string[] = []
      try {
        const operation = this.get(id)
        this.recheck(operation)
        secrets.push(...this.servers.redactionValues(operation.serverId))
        const result = this.reviewer ? await this.reviewer.review(operation.input.command, operation.input.cwd, secrets, controller.signal) : { status: 'unavailable' as const, reason: 'AI 辅助不可用，已保留人工审批' }
        const current = this.get(id)
        if (current.state !== 'awaiting_approval' || current.humanDecision) return
        this.recheck(current)
        const detail = this.reveal<Detail>(`${id}:detail`, this.row(id).detail)
        detail.decision!.aiReview = result
        this.db.prepare("UPDATE operations SET detail=?,updatedAt=? WHERE id=? AND state='awaiting_approval' AND decidedAt IS NULL").run(this.protect(`${id}:detail`, detail), Date.now(), id)
      } catch { /* Invalidation/storage failure never authorizes execution. */ }
      finally { clearTimeout(timer); secrets.length = 0; if (this.reviews.get(id) === controller) this.reviews.delete(id) }
    })()
  }
  private view(row: Row): Operation {
    const detail = this.reveal<Detail>(`${row.id}:detail`, row.detail)
    if (row.state === 'awaiting_approval' && detail.decision?.aiReview?.status === 'pending' && !this.reviews.has(row.id)) detail.decision.aiReview = { status: 'unavailable', reason: '分析未完成或已中断，已保留人工审批' }
    return { serverId: detail.input.serverId, id: row.id, profileId: row.profileId, state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt, intentAt: row.intentAt, outputBytes: row.outputBytes, errorCode: row.errorCode, replayClearedAt: row.replayClearedAt, replayClearReason: row.replayClearReason, decidedAt: row.decidedAt, humanDecision: row.humanDecision, ...detail, ...(row.result ? this.reveal<object>(`${row.id}:result`, row.result) : {}) }
  }
  get(id: string, owner?: string): Operation {
    this.servers.assertUnlocked()
    this.expirePending()
    const row = this.row(id)
    if (owner) { this.profile(owner); if (row.profileId !== owner) throw new AppError('ACCESS_DENIED') }
    const operation = this.view(row)
    if (owner) this.profile(owner, operation.serverId)
    const profile = this.db.prepare('SELECT expiresAt FROM profiles WHERE id=?').get(operation.profileId)
    return { ...operation, agentGuidance: operationGuidance(operation, Date.now(), profile?.expiresAt === null || profile?.expiresAt === undefined ? null : Number(profile.expiresAt)) }
  }
  private expirePending(): void {
    const now = Date.now()
    this.db.prepare("UPDATE operations SET state='expired',errorCode='ACCESS_DENIED',updatedAt=? WHERE state='awaiting_approval' AND (createdAt<=? OR profileId IN (SELECT id FROM profiles WHERE (expiresAt IS NOT NULL AND expiresAt<=?) OR revokedAt IS NOT NULL))").run(now, now - approvalLifetimeMs, now)
  }
  pendingIds(): string[] {
    if (this.servers.vaultState !== 'unlocked') return []
    this.expirePending()
    return this.db.prepare("SELECT id FROM operations WHERE state='awaiting_approval' ORDER BY createdAt,id LIMIT 20").all().map(row => String(row.id))
  }
  pendingCount(): number { if (this.servers.vaultState !== 'unlocked') return 0; this.expirePending(); return Number(this.db.prepare("SELECT COUNT(*) AS count FROM operations WHERE state='awaiting_approval'").get()!.count) }
  list(): Operation[] {
    this.servers.assertUnlocked(); this.expirePending()
    return (this.db.prepare('SELECT * FROM operations ORDER BY createdAt DESC LIMIT 200').all() as Row[]).map((row) => this.view(row))
  }
  decide(raw: unknown): void {
    const input = parse(z.object({ id: idSchema, approve: z.boolean() }).strict(), raw), operation = this.get(input.id)
    if (operation.state !== 'awaiting_approval') throw new AppError('OPERATION_STATE')
    this.reviews.get(operation.id)?.abort()
    if (!input.approve) { this.db.prepare("UPDATE operations SET state='denied',humanDecision='denied',decidedAt=?,updatedAt=? WHERE id=?").run(Date.now(), Date.now(), operation.id); return }
    this.recheck(operation)
    if (this.active.size + this.browsing.size >= 4) throw new AppError('OPERATION_LIMIT')
    this.db.prepare("UPDATE operations SET state='queued',humanDecision='approved',decidedAt=?,updatedAt=? WHERE id=?").run(Date.now(), Date.now(), operation.id); this.schedule(operation.id)
  }
  private recheck(operation: Operation, dispatched = false): AccessProfile {
    const profile = this.profile(operation.profileId, operation.serverId)
    if ((operation.profileRevision ?? 1) !== profile.revision) throw new AppError('ACCESS_DENIED')
    if (operation.context) { if (!this.validateContext) throw new AppError('CONTEXT_CHANGED'); this.validateContext(operation.context) }
    if (dispatched) { if (this.snapshot(operation.serverId).snapshot !== operation.snapshot) throw new AppError('CONFIG_CHANGED'); return profile }
    const currentDecision = operation.transfer ? this.fileAdapter!.decision(operation.profileId, operation.transfer) : this.commandDecision(operation.input, operation.profileId, operation.context)
    const { aiReview: _advisory, ...original } = operation.decision ?? {}
    if (operation.decision?.queryPlan?.scopeRevision && operation.decision.queryPlan.scopeRevision !== currentDecision.queryPlan?.scopeRevision) throw new AppError('CONTEXT_CHANGED')
    if (!operation.decision || currentDecision.action === 'deny' || JSON.stringify(currentDecision) !== JSON.stringify(original)) throw new AppError('POLICY_CHANGED')
    if (operation.createdAt + approvalLifetimeMs <= Date.now()) throw new AppError('ACCESS_DENIED')
    if (this.snapshot(operation.serverId).snapshot !== operation.snapshot) throw new AppError('CONFIG_CHANGED')
    return profile
  }
  private state(id: string, state: OperationState, code: ErrorCode | null = null): void {
    this.db.prepare('UPDATE operations SET state=?,errorCode=?,updatedAt=? WHERE id=?').run(state, code, Date.now(), id)
  }
  private schedule(id: string): void {
    try { this.recordings.reserve() } catch (e) { this.state(id, 'interrupted', e instanceof AppError ? e.code : 'STORAGE_FAILED'); throw e }
    // Reserve concurrency synchronously; no queue race between requests in the same tick.
    this.active.set(id, { profileId: this.row(id).profileId, cancel: (code) => this.state(id, 'interrupted', code) })
    setImmediate(() => { void this.run(id).catch(() => { this.halted = true }).finally(() => this.active.delete(id)) })
  }
  private async run(id: string): Promise<void> {
    let sent = false, transferPublicationAttempted: boolean | undefined
    try {
      const operation = this.get(id)
      if (operation.state !== 'queued') return
      this.recheck(operation)
      this.state(id, 'connecting')
      await this.servers.withConnection(operation.serverId, async (client, scope) => {
        if (this.row(id).state !== 'connecting') throw new AppError(this.row(id).errorCode ?? 'CANCEL_REQUESTED')
        const profile = this.recheck(operation)
        scope.controller.signal.throwIfAborted()
        this.active.set(id, { profileId: operation.profileId, cancel: (code) => scope.fail(new AppError(code)) })
        const deadline = operation.transfer ? new TransferDeadline(operation.transfer.totalTimeoutMs ?? operation.input.timeoutMs, operation.transfer.idleTimeoutMs ?? 120000, error => scope.fail(error)) : undefined
        const timer = operation.transfer ? undefined : setTimeout(() => scope.fail(new AppError('COMMAND_TIMEOUT')), operation.input.timeoutMs)
        let expiry: ReturnType<typeof setTimeout> | undefined
        const watchExpiry = () => {
          try {
            const current = this.profile(operation.profileId, operation.serverId)
            if (current.expiresAt !== null) expiry = setTimeout(watchExpiry, Math.min(2147483647, Math.max(1, current.expiresAt - Date.now())))
          } catch { scope.fail(new AppError('ACCESS_DENIED')) }
        }
        watchExpiry()
        let lastWork = -1, lastStage: string | undefined
        try {
          // Durable intent must succeed before exec can reach the wire.
          this.db.prepare("UPDATE operations SET state='dispatching',intentAt=?,updatedAt=? WHERE id=?").run(Date.now(), Date.now(), id)
          this.recheck(operation)
          if (operation.transfer) {
            const result = await this.fileAdapter!.run(operation, client, scope, result => {
              this.db.prepare('UPDATE operations SET result=?,updatedAt=? WHERE id=?').run(this.protect(`${id}:result`, { fileResult: result }), Date.now(), id)
              transferPublicationAttempted = result.publicationAttempted
              const work = (result.preparedBytes ?? 0) + result.bytes + (result.verifiedBytes ?? 0)
              if (work > lastWork || result.stage !== lastStage) { deadline?.progress(); lastWork = work; lastStage = result.stage }
            }, () => { sent = true; this.state(id, 'running') }, () => { this.recheck(operation, true); scope.controller.signal.throwIfAborted() })
            this.db.prepare('UPDATE operations SET result=? WHERE id=?').run(this.protect(`${id}:result`, { fileResult: result }), id)
            this.state(id, 'succeeded'); return
          }
          const marker = randomBytes(24).toString('hex')
          let channel: ClientChannel | undefined
          let header = Buffer.alloc(0), headerDone = false, seq = 0
          let exitCode: number | undefined, signal: string | undefined, confirmedCwd: string | undefined
          const secrets = this.servers.redactionValues(operation.serverId)
          const filters = { stdout: new SecretFilter(secrets), stderr: new SecretFilter(secrets), metadata: new SecretFilter(secrets) }
          secrets.length = 0
          const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
          const append = (stream: 'stdout' | 'stderr', data: Buffer, final = false) => {
            for (let offset = 0; offset < data.length || (final && offset === 0); offset += 8192) {
              const chunk = data.subarray(offset, offset + 8192)
              const text = filters[stream].push(final ? decoders[stream].end() : decoders[stream].write(chunk), final)
              const row = this.row(id)
              if (row.outputBytes + chunk.length > 1048576) throw new AppError('OPERATION_LIMIT')
              this.db.exec('BEGIN IMMEDIATE')
              try {
                for (const part of text.match(/[\s\S]{1,2048}/gu) ?? []) {
                  this.db.prepare("INSERT INTO operation_output(operationId,seq,stream,elapsedMs,data,encoding) VALUES(?,?,?,?,?,'gzip-json')").run(id, seq, stream, Date.now() - operation.createdAt, this.recordings.encode(`${id}:output:${seq}:${stream}`, part)); seq++
                }
                this.db.prepare('UPDATE operations SET outputBytes=outputBytes+? WHERE id=?').run(chunk.length, id)
                this.db.exec('COMMIT')
              } catch { this.db.exec('ROLLBACK'); this.halted = true; throw new AppError('STORAGE_FAILED') }
            }
          }
          let sudo: SudoConversation | undefined, sudoTimer: ReturnType<typeof setTimeout> | undefined
          const receive = (stream: 'stdout' | 'stderr', data: Buffer) => {
            if (scope.controller.signal.aborted) return
            try {
              if (stream === 'stderr' && sudo) data = sudo.stderr(data)
              if (stream === 'stdout' && !headerDone) {
                header = Buffer.concat([header, data])
                const first = header.indexOf(0), second = first < 0 ? -1 : header.indexOf(0, first + 1)
                if (second < 0) { if (header.length > 8192) throw new AppError('CONNECTION_FAILED'); return }
                if (header.subarray(0, first).toString() !== marker) throw new AppError('CONNECTION_FAILED')
                const cwd = header.subarray(first + 1, second).toString('utf8')
                if (second - first > 4097 || !cwd.startsWith('/')) throw new AppError('CONNECTION_FAILED')
                confirmedCwd = filters.metadata.push(cwd, true); headerDone = true
                sudo?.ready(); clearTimeout(sudoTimer); if (sudo) channel?.end()
                this.db.prepare('UPDATE operations SET result=? WHERE id=?').run(this.protect(`${id}:result`, { confirmedCwd }), id)
                data = header.subarray(second + 1); header = Buffer.alloc(0)
              }
              if (data.length) append(stream, data)
            } catch (error) { scope.fail(error instanceof AppError ? error : new AppError('STORAGE_FAILED')) }
          }
          const elevated = operation.input.elevation === 'sudo'
          const password = elevated ? this.servers.elevationPassword(operation.serverId) : undefined
          const sudoPrompt = `HH_SUDO_${randomBytes(24).toString('hex')}:`
          const command = remoteCommand({ ...operation.input, command: operation.decision?.queryPlan?.command ?? (elevated ? normalizeElevation(operation.input).command : operation.input.command) }, marker)
          const wireCommand = elevated ? sudoCommand(command, sudoPrompt, !!password) : command
          // The final authorization check precedes both exec and any credential send.
          try { this.recheck(operation)
          sent = true
          await scope.wait(new Promise<void>((resolve, reject) => {
            client.exec(wireCommand, { pty: false }, (error, stream) => {
              if (error) { reject(new AppError('CONNECTION_FAILED')); return }
              channel = scope.own(stream)
              if (scope.controller.signal.aborted) return
              try { this.state(id, 'running') } catch { this.halted = true; scope.fail(new AppError('STORAGE_FAILED')); return }
              if (elevated) {
                sudo = new SudoConversation(sudoPrompt, password, line => {
                  try { this.recheck(operation, true); scope.controller.signal.throwIfAborted(); stream.write(line, () => line.fill(0)); stream.end() }
                  catch (error) { line.fill(0); throw error }
                })
                sudoTimer = setTimeout(() => scope.fail(new AppError('SUDO_TIMEOUT')), 15000)
              }
              stream.on('data', (data: Buffer) => receive('stdout', data))
              stream.stderr.on('data', (data: Buffer) => receive('stderr', data))
              stream.on('error', () => scope.fail(new AppError('CONNECTION_FAILED')))
              stream.on('exit', (code: number | null, sig?: string) => { if (typeof code === 'number') exitCode = code; signal = sig && /^(ABRT|ALRM|FPE|HUP|ILL|INT|KILL|PIPE|QUIT|SEGV|TERM|USR1|USR2)$/.test(sig) ? sig : undefined })
              stream.on('close', () => resolve())
              if (!password) stream.end() // No input reaches the target command; no PTY/echo.
            })
          }))
          if (sudo) { const rest = sudo.finish(); if (rest.length) append('stderr', rest) }
          } finally { clearTimeout(sudoTimer); sudo?.close(); password?.fill(0) }
          if (elevated && exitCode !== undefined && !headerDone && header.length === 0) {
            for (const stream of ['stdout', 'stderr'] as const) append(stream, Buffer.alloc(0), true)
            this.db.prepare('UPDATE operations SET result=? WHERE id=?').run(this.protect(`${id}:result`, { exitCode, signal }), id)
            this.state(id, 'failed', exitCode === 125 ? 'CWD_FAILED' : 'SUDO_FAILED'); return
          }
          const cwdFailed = exitCode === 125 && !headerDone && header.length === 0
          if (!channel || exitCode === undefined || (!headerDone && !cwdFailed)) { this.state(id, 'unknown', 'CONNECTION_FAILED'); return }
          for (const stream of ['stdout', 'stderr'] as const) append(stream, Buffer.alloc(0), true)
          this.db.prepare('UPDATE operations SET result=? WHERE id=?').run(this.protect(`${id}:result`, { confirmedCwd, exitCode, signal }), id)
          this.state(id, exitCode === 0 ? 'succeeded' : 'failed', cwdFailed ? 'CWD_FAILED' : null)
        } finally { clearTimeout(timer); clearTimeout(expiry); deadline?.close() }
      }, true, operation.input.connectTimeoutMs, (scope) => { this.active.set(id, { profileId: operation.profileId, cancel: (code) => scope.fail(new AppError(code)) }) })
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'STORAGE_FAILED'
      if (code === 'STORAGE_FAILED') this.halted = true
      // Before publication there can be partial staging data, but no final-file
      // publication request has been sent. Never infer this for older records.
      const failedBeforePublication = transferPublicationAttempted === false && code !== 'STORAGE_FAILED'
      this.state(id, failedBeforePublication ? 'failed' : sent ? 'unknown' : 'interrupted', code)
    }
  }
  cancel(id: string, owner?: string): Operation {
    const operation = this.get(id, owner)
    if (terminal.has(operation.state)) return operation
    this.reviews.get(id)?.abort()
    if (this.active.has(id)) this.active.get(id)!.cancel('CANCEL_REQUESTED')
    else this.state(id, 'denied', 'CANCEL_REQUESTED')
    return this.get(id, owner)
  }
  read(id: string, cursor: number, owner?: string): OutputPage {
    this.recordings.sweepIfDue()
    const operation = this.get(id, owner)
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new AppError('INVALID_INPUT')
    const rows = this.db.prepare('SELECT * FROM operation_output WHERE operationId=? AND seq>=? ORDER BY seq LIMIT 8').all(id, cursor)
    const chunks = rows.map((row) => ({ seq: Number(row.seq), stream: row.stream as 'stdout' | 'stderr', elapsedMs: Number(row.elapsedMs), text: this.recordings.decode(`${id}:output:${row.seq}:${row.stream}`, row.data as Uint8Array, String(row.encoding)) }))
    const guidance = operation.agentGuidance
    return { chunks, nextCursor: chunks.length ? chunks[chunks.length - 1].seq + 1 : cursor, state: operation.state, replayClearedAt: operation.replayClearedAt,
      agentGuidance: !chunks.length && guidance?.nextAction === 'read_output' ? { ...guidance, nextAction: 'stop', message: '原操作已结束，当前游标没有更多保留输出。停止读取并分析已有结果；输出可能已清理，不要重新执行来补录。' } : guidance }
  }
  history(raw: unknown) {
    this.servers.assertUnlocked(); this.expirePending(); this.recordings.maintain()
    const input = parse(z.object({ kind: z.literal('file-transfer').optional(), transferDirection: z.enum(['upload', 'download']).optional(), serverId: idSchema.optional(), profileId: idSchema.optional(), state: z.enum(['awaiting_approval','queued','connecting','dispatching','running','succeeded','failed','denied','interrupted','unknown','expired']).optional(), stateGroup: z.enum(['active', 'terminal']).optional(), since: z.number().int().nonnegative().optional(), until: z.number().int().nonnegative().optional(), search: z.string().max(200).optional(), offset: z.number().int().min(0).max(10000).default(0), pageSize: z.union([z.literal(20), z.literal(50), z.literal(100)]).default(50), includeOptions: z.boolean().optional() }).strict().refine(q => q.since === undefined || q.until === undefined || q.since <= q.until), raw)
    const rows = this.db.prepare('SELECT * FROM operations ORDER BY createdAt DESC,id DESC LIMIT 10000').all() as Row[]
    const rowMatches = (r: Pick<Row, 'profileId' | 'state' | 'createdAt'>) => (!input.profileId || r.profileId === input.profileId) && (!input.state || r.state === input.state) && (!input.stateGroup || (input.stateGroup === 'terminal' ? terminal.has(r.state) : !terminal.has(r.state))) && (input.since === undefined || r.createdAt >= input.since) && (input.until === undefined || r.createdAt <= input.until)
    const views = (input.includeOptions ? rows : rows.filter(rowMatches)).map(r => this.view(r))
    const matching = views.filter(o => (!input.kind || !!o.transfer && ['upload', 'download'].includes(o.transfer.request.direction)) && (!input.transferDirection || o.transfer?.request.direction === input.transferDirection) && (!input.includeOptions || rowMatches(o)) && (!input.serverId || o.serverId === input.serverId) && (!input.search || `${o.input.command} ${o.serverName} ${o.profileName}`.toLocaleLowerCase().includes(input.search.toLocaleLowerCase())))
    const options = input.includeOptions ? {
      servers: [...new Map([...views.map(o => ({ id: o.serverId, name: o.serverName })), ...this.servers.listServers().map(s => ({ id: s.id, name: s.name }))].map(s => [s.id, s])).values()],
      profiles: [...new Map([...views.map(o => ({ id: o.profileId, name: o.profileName })), ...this.listProfiles(true).map(p => ({ id: p.id, name: p.name }))].map(p => [p.id, p])).values()],
    } : undefined
    return { operations: matching.slice(input.offset, input.offset + input.pageSize), total: matching.length, offset: input.offset, pageSize: input.pageSize, ...(options ? { options } : {}) }
  }

  deleteRecord(raw: unknown): void {
    const id = parse(idSchema, raw), operation = this.get(id)
    if (!terminal.has(operation.state) || this.active.has(id)) throw new AppError('STORAGE_BUSY')
    if (Number(this.db.prepare('SELECT COUNT(*) count FROM operation_tombstones').get()!.count) >= 100000) throw new AppError('OPERATION_LIMIT')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.row(id)
      this.db.prepare('INSERT INTO operation_tombstones(profileId,requestKey) VALUES(?,?)').run(row.profileId, row.requestKey)
      this.db.prepare('DELETE FROM operation_output WHERE operationId=?').run(id)
      this.db.prepare('DELETE FROM operations WHERE id=?').run(id)
      this.db.exec('COMMIT')
    } catch { this.db.exec('ROLLBACK'); throw new AppError('STORAGE_FAILED') }
  }
  close(): void { this.recordings.close(); this.policy.changed.delete(this.policyChanged); this.invalidate('CORE_UNAVAILABLE'); this.servers.invalidated.delete(this.invalidate) }
}
