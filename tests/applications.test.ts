import { mcpToolDefinitions, toolInputJsonSchema, type McpToolName } from '../src/shared/mcp-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { OperationService } from '../src/core/operations/service'
import { InvestigationService } from '../src/core/investigation/service'
import { AiService } from '../src/core/ai/service'
import { ApplicationService, logCommand } from '../src/core/applications/service'
import { logQuerySchema } from '../src/shared/application'
import { sshFixture } from './helpers/routes'
import { fixtureReport } from './helpers/investigation'
import { LocalMcpServer } from '../src/core/mcp/server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture() {
  const remote = await sshFixture({ exec: (command, stream) => {
    stream.write(`${command.match(/[a-f0-9]{48}/)![0]}\0/\0synthetic login failed\n`); stream.exit(0); stream.end()
  } }); cleanup.push(() => remote.close())
  const directory = mkdtempSync(join(tmpdir(), 'hh-apps-')), path = join(directory, 'db')
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const key = randomBytes(32), servers = new ServerService(new Store(path)); servers.unlock(key)
  const credential = servers.saveCredential({ name: 'fixture', kind: 'password', password: 'target-secret' })
  const server = servers.saveServer({ name: 'synthetic-server', host: '127.0.0.1', port: remote.port, username: 'target-user', credentialId: credential.id })
  const challenge = await servers.testConnection(server.id); if (challenge.status !== 'host-key-required') throw new Error(); servers.trustHost(challenge.challengeId)
  const other = servers.saveServer({ name: 'unauthorized', host: '127.0.0.1', port: 2, username: 'synthetic', credentialId: credential.id })
  const operations = new OperationService(servers), ai = new AiService(servers), investigations = new InvestigationService(operations, ai)
  const apps = new ApplicationService(operations, investigations)
  const access = operations.createProfile({ name: 'client', serverIds: [server.id], mode: 'policy', expiresAt: Date.now() + 60000 })
  cleanup.push(() => { investigations.close(); ai.close(); operations.close(); servers.close() })
  const input = { serverId: server.id, revision: 0, name: 'Login platform', aliases: ['lpp'], description: 'Synthetic login service', environment: 'test', deploymentPath: '/srv/lpp', runtime: 'systemd' as const, runtimeTarget: 'lpp.service', logSources: [{ id: randomUUID(), name: 'app log', kind: 'journal' as const, target: 'lpp.service', timezone: 'UTC' }] }
  const app = apps.save(input)
  const query = { serverId: server.id, applicationId: app.id, applicationRevision: app.revision, sourceId: app.logSources[0].id, requestKey: 'logs', since: '2026-10-21T00:00:00Z', until: '2026-10-21T00:30:00Z' }
  return { directory, path, servers, server, other, operations, apps, access, app, input, query, remote, key, investigations }
}
describe('application operational context', () => {
  it('authorizes maintained literal files and binds generic queries to app revisions before dispatch', async () => {
    const f = await fixture()
    f.operations.policy.save({ revision: 0, mode: 'assisted', rules: [], aiAssist: false })
    const source = { id: randomUUID(), name: 'synthetic literal log', kind: 'file' as const, target: '/custom/synthetic/runtime.trace', timezone: 'UTC' }
    const app = f.apps.save({ ...f.input, id: f.app.id, revision: f.app.revision, logSources: [source] })
    const raw = { serverId: f.server.id, requestKey: 'synthetic-file-context', cwd: '/custom/synthetic', command: 'tail -100 runtime.trace' }
    const first = f.operations.start(f.access.profile.id, raw)
    expect(first.decision?.action).toBe('allow')
    expect(first.decision?.queryPlan?.scopeRevision).toBeTypeOf('string')
    const changed = f.apps.save({ ...f.input, id: app.id, revision: app.revision, description: 'synthetic changed context', logSources: [source] })
    await vi.waitFor(() => expect(f.operations.get(first.id).state).toBe('interrupted'))
    expect(f.operations.get(first.id).intentAt).toBeNull()
    const next = f.operations.start(f.access.profile.id, { ...raw, requestKey: 'synthetic-file-context-current' })
    await vi.waitFor(() => expect(f.operations.get(next.id).state).toBe('succeeded'))
    expect(f.operations.get(next.id).input.command).toBe(raw.command)
    f.apps.save({ ...f.input, id: app.id, revision: changed.revision, logSources: [] })
    const removed = f.operations.start(f.access.profile.id, { ...raw, requestKey: 'synthetic-file-context-removed' })
    expect(removed.state).toBe('awaiting_approval'); expect(removed.intentAt).toBeNull()
    expect(() => f.operations.start(f.access.profile.id, { ...raw, requestKey: 'synthetic-injected-scope', queryScope: { logFiles: [source.target] } })).toThrow()
    f.operations.decide({ id: removed.id, approve: false })
  })
  it('auto-passes only the maintained, version-bound log query in assisted mode', async () => {
    const f = await fixture()
    f.operations.policy.save({ revision: 0, mode: 'assisted', rules: [] })
    const op = f.apps.queryLogs(f.access.profile.id, f.query)
    expect(op.decision).toMatchObject({ action: 'allow', matchedRules: [{ id: 'builtin:application-log' }] })
    expect(op.state).toBe('queued')
    const plain = f.operations.start(f.access.profile.id, { ...op.input, requestKey: 'untrusted-shell-copy' })
    expect(plain.state).toBe('awaiting_approval')
    f.apps.save({ ...f.input, id: f.app.id, revision: f.app.revision, description: 'changed synthetic context' })
    await vi.waitFor(() => expect(f.operations.get(op.id).state).toBe('interrupted'))
    expect(f.operations.get(op.id).intentAt).toBeNull()
  })
  it('persists encrypted, scoped stable identities and rejects stale edits, locked/expired/revoked reads', async () => {
    const f = await fixture()
    expect(f.apps.find(f.access.profile.id, { serverId: f.server.id, query: 'LPP' }).applications[0].id).toBe(f.app.id)
    expect(f.apps.serverContext(f.access.profile.id, f.server.id).report).toBeNull()
    expect(() => f.apps.find(f.access.profile.id, { serverId: f.other.id })).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }))
    expect(() => f.apps.serverContext(f.access.profile.id, f.other.id)).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }))
    expect(() => f.apps.save({ ...f.input, id: f.app.id })).toThrowError(expect.objectContaining({ code: 'CONTEXT_CHANGED' }))
    const bytes = readFileSync(f.path); expect(bytes.includes(Buffer.from('Login platform'))).toBe(false); expect(bytes.includes(Buffer.from('/srv/lpp'))).toBe(false)
    f.servers.lock(); expect(() => f.apps.list(f.server.id)).toThrowError(expect.objectContaining({ code: 'VAULT_LOCKED' })); f.servers.unlock(f.key)
    f.servers.store.db.prepare('UPDATE profiles SET expiresAt=? WHERE id=?').run(Date.now() - 1, f.access.profile.id)
    expect(() => f.apps.find(f.access.profile.id, { serverId: f.server.id })).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }))
    f.servers.store.db.prepare('UPDATE profiles SET expiresAt=?,revokedAt=? WHERE id=?').run(Date.now() + 60000, Date.now(), f.access.profile.id)
    expect(() => f.apps.serverContext(f.access.profile.id, f.server.id)).toThrowError(expect.objectContaining({ code: 'ACCESS_DENIED' }))
    const second = new ServerService(new Store(f.path)); second.unlock(f.key)
    const secondOperations = new OperationService(second)
    try { expect(new ApplicationService(secondOperations, f.investigations).list(f.server.id)[0]).toEqual(f.app) } finally { secondOperations.close(); second.close() }
  })
  it('imports provenance only from a saved report and report refresh never overwrites manual context', async () => {
    const f = await fixture(), runId = randomUUID(), evidenceId = randomUUID()
    const report = { snapshot: f.operations.snapshot(f.server.id).snapshot, runId, serverRevision: f.server.revision, collectedAt: Date.now(), model: 'synthetic', content: fixtureReport(evidenceId), evidence: [] }
    const persist = () => {
      const plain = Buffer.from(JSON.stringify({ run: null, report }))
      f.servers.store.db.prepare('INSERT OR REPLACE INTO server_dossiers VALUES(?,?)').run(f.server.id, f.servers.protect(`server-dossier:${f.server.id}`, plain)); plain.fill(0)
    }
    persist()
    const imported = f.apps.save({ ...f.input, name: 'Manual override', discovery: { runId, index: 0 } })
    expect(imported.discovery?.evidenceIds).toEqual([evidenceId])
    report.content.applications[0].name = 'Changed discovery'; persist()
    expect(f.apps.list(f.server.id).find(a => a.id === imported.id)?.name).toBe('Manual override')
    expect(f.apps.serverContext(f.access.profile.id, f.server.id).report?.runtimeFreshness).toBe('not-live')
    f.investigations.edit({ serverId: f.server.id, runId, revision: 0, content: { ...report.content, overview: 'Manual context for MCP' } })
    const context = f.apps.serverContext(f.access.profile.id, f.server.id)
    expect(context.report?.content.overview).toBe('Manual context for MCP')
    expect(context.report?.manualFields).toEqual(['overview'])
    expect(JSON.stringify(f.apps.serverContext(f.access.profile.id, f.server.id))).not.toContain('preview')
    expect(() => f.apps.save({ ...f.input, discovery: { runId: randomUUID(), index: 0 } })).toThrowError(expect.objectContaining({ code: 'CONTEXT_CHANGED' }))
  })
  it('uses normal approval/output, freezes log selection, deduplicates after edits and rechecks before approval', async () => {
    const f = await fixture(), op = f.apps.queryLogs(f.access.profile.id, f.query)
    expect(op.state).toBe('awaiting_approval'); expect(f.remote.sessions).toBe(0)
    expect(op.context?.timeWindowApplied).toBe(true)
    expect(() => f.apps.queryLogs(f.access.profile.id, { ...f.query, applicationRevision: 2 })).toThrowError(expect.objectContaining({ code: 'REQUEST_CONFLICT' }))
    f.operations.decide({ id: op.id, approve: true })
    await vi.waitFor(() => expect(f.operations.get(op.id).state).toBe('succeeded'))
    expect(f.operations.read(op.id, 0, f.access.profile.id).chunks.map(c => c.text).join('')).toContain('synthetic login failed')
    const pending = f.apps.queryLogs(f.access.profile.id, { ...f.query, requestKey: 'pending' })
    f.apps.save({ ...f.input, id: f.app.id, revision: f.app.revision, name: 'renamed' })
    expect(f.apps.queryLogs(f.access.profile.id, f.query).id).toBe(op.id)
    expect(() => f.operations.decide({ id: pending.id, approve: true })).toThrowError(expect.objectContaining({ code: 'CONTEXT_CHANGED' }))
    expect(f.remote.sessions).toBe(1)
    f.apps.remove({ serverId: f.server.id, id: f.app.id, revision: 2 })
    expect(f.apps.queryLogs(f.access.profile.id, f.query).id).toBe(op.id)
    expect(() => f.apps.queryLogs(f.access.profile.id, { ...f.query, requestKey: 'new' })).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
  })
  it('rejects queued execution after an app edit and requires reconfirmation after server configuration changes', async () => {
    const f = await fixture()
    const waiting = f.apps.queryLogs(f.access.profile.id, f.query)
    f.operations.decide({ id: waiting.id, approve: true })
    f.apps.save({ ...f.input, id: f.app.id, revision: f.app.revision })
    await vi.waitFor(() => expect(f.operations.get(waiting.id).state).toBe('interrupted'))
    expect(f.remote.sessions).toBe(0)
    const { revision: _revision, createdAt: _created, ...server } = f.server
    f.servers.saveServer({ ...server, name: 'updated server' })
    expect(f.apps.list(f.server.id)[0].connectionChanged).toBe(true)
    expect(() => f.apps.queryLogs(f.access.profile.id, { ...f.query, applicationRevision: 2, requestKey: 'changed-server' })).toThrowError(expect.objectContaining({ code: 'CONTEXT_CHANGED' }))
    expect(() => f.apps.save({ ...f.input, id: f.app.id, revision: 2, serverRevision: f.server.revision })).toThrowError(expect.objectContaining({ code: 'CONTEXT_CHANGED' }))
    const confirmed = f.apps.save({ ...f.input, id: f.app.id, revision: 2, serverRevision: f.server.revision + 1 })
    expect(confirmed.connectionChanged).toBe(false)
    expect(f.apps.queryLogs(f.access.profile.id, { ...f.query, applicationRevision: 3, requestKey: 'confirmed' }).state).toBe('awaiting_approval')
  })
  it('fails closed for malformed encrypted records and keeps server deletion scoped', async () => {
    const f = await fixture(), data = Buffer.from(JSON.stringify({ ...f.app, serverId: f.other.id }))
    f.servers.store.db.prepare('UPDATE applications SET detail=? WHERE id=?').run(f.servers.protect(`application:${f.app.id}`, data), f.app.id); data.fill(0)
    expect(() => f.apps.list(f.server.id)).toThrowError(expect.objectContaining({ code: 'STORAGE_FAILED' }))
    f.servers.store.db.prepare('DELETE FROM servers WHERE id=?').run(f.server.id)
    expect(f.servers.store.db.prepare('SELECT * FROM applications').all()).toHaveLength(0)
    expect(f.servers.store.getServer(f.other.id)).toBeDefined()
  })
  it('exposes the eight production tools over real authenticated MCP and denies cross-server metadata/log access', async () => {
    const f = await fixture(), mcp = new LocalMcpServer(f.operations, 0, f.apps)
    const endpoint = (await mcp.start()).url!, client = new Client({ name: 'synthetic', version: '1' })
    cleanup.push(() => mcp.stop()); cleanup.push(() => client.close())
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${f.access.token}` } } }))
    const unpack = (v: any) => JSON.parse(v.content[0].text)
    const runtimeTools = (await client.listTools()).tools
    expect(runtimeTools).toHaveLength(12)
    expect(runtimeTools.map(t => t.name).sort()).toEqual(Object.keys(mcpToolDefinitions).sort())
    for (const tool of runtimeTools) {
      const name = tool.name as McpToolName, schema = toolInputJsonSchema(name)
      expect(tool.description).toBe(mcpToolDefinitions[name].description)
      expect(tool.inputSchema.properties).toEqual(schema.properties)
      expect(tool.inputSchema.required ?? []).toEqual(schema.required ?? [])
      expect(tool.inputSchema.additionalProperties).toEqual(schema.additionalProperties)
    }
    const servers = unpack(await client.callTool({ name: 'list_servers', arguments: { query: 'synthetic-server' } })); expect(servers).toHaveLength(1)
    expect(unpack(await client.callTool({ name: 'find_applications', arguments: { serverId: servers[0].id, query: 'lpp' } })).applications[0].id).toBe(f.app.id)
    expect(unpack(await client.callTool({ name: 'get_server_context', arguments: { serverId: f.server.id } })).applications[0].name).toBe(f.app.name)
    expect(unpack(await client.callTool({ name: 'get_server_context', arguments: { serverId: f.other.id } })).error.code).toBe('ACCESS_DENIED')
    expect(unpack(await client.callTool({ name: 'query_application_logs', arguments: { ...f.query, serverId: f.other.id } })).error.code).toBe('ACCESS_DENIED')
    const op = unpack(await client.callTool({ name: 'query_application_logs', arguments: f.query })); expect(op.state).toBe('awaiting_approval'); expect(f.remote.sessions).toBe(0)
  })
  it('bounds time windows and inputs, prevents shell injection and reports upstream errors instead of success', async () => {
    const f = await fixture()
    expect(logQuerySchema.safeParse({ ...f.query, until: f.query.since }).success).toBe(false)
    expect(logQuerySchema.safeParse({ ...f.query, until: '2026-10-23T00:00:00Z' }).success).toBe(false)
    expect(logQuerySchema.safeParse({ ...f.query, contains: 'x\ny' }).success).toBe(false)
    expect(() => f.apps.save({ ...f.input, logSources: [{ ...f.input.logSources[0], target: 'lpp.service;echo hacked' }] })).toThrow()
    expect(() => f.apps.save({ ...f.input, logSources: [{ ...f.input.logSources[0], kind: 'docker', target: '--privileged' }] })).toThrow()
    if (process.platform === 'win32') return // Shell semantics are separately verified on Linux/macOS; Windows client still targets Linux.
    const path = join(f.directory, "literal'$(touch HACKED).log")
    writeFileSync(path, 'old\nlogin failed\nlast\n')
    const query = logQuerySchema.parse({ ...f.query, contains: 'login failed', lines: 2 })
    const source = { id: randomUUID(), kind: 'file' as const, name: 'fixture', target: path, timezone: '' }
    expect(execFileSync('sh', ['-c', logCommand(source, query)], { cwd: f.directory, encoding: 'utf8' })).toBe('login failed\n')
    expect(spawnSync('sh', ['-c', logCommand({ ...source, target: path + '.missing' }, query)]).status).not.toBe(0)
    expect(spawnSync('sh', ['-c', 'test -e HACKED'], { cwd: f.directory }).status).toBe(1)
    const app = f.apps.save({ ...f.input, logSources: [source] })
    const op = f.apps.queryLogs(f.access.profile.id, { ...f.query, applicationId: app.id, sourceId: source.id })
    expect(op.context?.timeWindowApplied).toBe(false); expect(op.context?.selection).toContain('NOT applied')
  })
})
