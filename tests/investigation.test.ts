import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { OperationService } from '../src/core/operations/service'
import { AiService } from '../src/core/ai/service'
import { InvestigationService } from '../src/core/investigation/service'
import { overviewCommand, runtimesCommand, queryCommand } from '../src/core/investigation/tools'
import { sshFixture } from './helpers/routes'
import { requestEvidence, fixtureReport } from './helpers/investigation'
import { isInvestigating } from '../src/shared/dossier'
import { AppError } from '../src/shared/errors'
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture(provider: 'openai' | 'anthropic' = 'openai', automatic = true) {
  const commands: string[] = []
  const remote = await sshFixture({ exec: (command, stream) => {
    commands.push(command)
    stream.write(`${command.match(/[a-f0-9]{48}/)![0]}\0/\0`)
    stream.write('Linux Synthetic OS\n[cpu] 4\n[memory] 8 GiB\n123 node\nfixture.service\n/srv/fixture-web\nabcdef123456\n8080/tcp\ntarget-secret\nsk-syntheticsecret0000000000\n')
    stream.exit(0); stream.end()
  } }); cleanup.push(() => remote.close())
  const dir = mkdtempSync(join(tmpdir(), 'hh-investigation-')), path = join(dir, 'db.sqlite')
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const servers = new ServerService(new Store(path)), key = randomBytes(32); servers.unlock(key)
  const credential = servers.saveCredential({ name: 'fixture', kind: 'password', password: 'target-secret' })
  const server = servers.saveServer({ name: 'synthetic', host: '127.0.0.1', port: remote.port, username: 'target-user', credentialId: credential.id })
  const trust = await servers.testConnection(server.id); if (trust.status !== 'host-key-required') throw new Error(); servers.trustHost(trust.challengeId)
  const operations = new OperationService(servers)
  const processCommand = queryCommand({ query: 'process', target: '123', purpose: 'test' }, [{ id: randomUUID(), operationId: randomUUID(), query: 'runtimes', target: '', purpose: '', state: 'succeeded', errorCode: null, preview: '123 node', truncated: false }])
  if (automatic) operations.policy.save({ revision: 0, mode: 'rules', rules: [overviewCommand, runtimesCommand, processCommand].map(command => ({ id: randomUUID(), name: 'synthetic exact collector', enabled: true, action: 'allow', profileIds: [], serverIds: [server.id], command, cwd: '/', expiresAt: null })) })
  let invalid = false, foreign = false, hold = false, evil = false, malformed = false, truncated = false, batch = false
  const bodies: any[] = []
  const fetcher = vi.fn(async (_url: any, options: any) => {
    expect(String(_url)).toBe(provider === 'anthropic' ? 'https://fixture.test/anthropic/v1/messages' : 'https://fixture.test/anthropic/chat/completions')
    expect(options.headers[provider === 'anthropic' ? 'x-api-key' : 'Authorization']).toBe(provider === 'anthropic' ? 'api-secret' : 'Bearer api-secret')
    const body = JSON.parse(options.body); bodies.push(body)
    if (hold) return await new Promise<Response>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    if (truncated && bodies.length === 1) return new Response(JSON.stringify(provider === 'anthropic' ? { stop_reason: 'max_tokens', content: [] } : { choices: [{ finish_reason: 'length', message: { content: null } }] }))
    const evidence = requestEvidence(body)
    const call = bodies.length === 1 ? { id: 'call-followup', name: 'investigate', input: { query: 'process', target: '123', purpose: '确认 Node 工作目录' } } : { id: 'call-report', name: 'save_report', input: fixtureReport(foreign ? randomUUID() : evidence[0].id) }
    if (malformed && bodies.length === 2) call.input = { overview: 'incomplete' } as any
    if (evil) { call.name = 'exec_shell'; call.input = { command: 'rm -rf /' } as any }
    const calls = batch && bodies.length === 1 ? [call, { ...call, id: 'call-followup-2' }, { ...call, id: 'call-followup-3' }] : [call]
    return new Response(JSON.stringify(invalid ? { error: 'api-secret' } : provider === 'anthropic' ? { stop_reason: 'tool_use', content: calls.map(c => ({ type: 'tool_use', ...c })) } : { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } }] }))
  }) as typeof fetch
  const ai = new AiService(servers, 15000, fetcher)
  ai.save({ revision: 0, provider, baseUrl: 'https://fixture.test/anthropic', apiKey: 'api-secret', model: 'fixture-model' })
  const investigation = new InvestigationService(operations, ai, 5)
  cleanup.push(async () => { investigation.close(); ai.close(); await new Promise(r => setTimeout(r, 40)); operations.close(); servers.close() })
  const start = () => investigation.start({ serverId: server.id, serverRevision: server.revision, aiRevision: ai.get().revision })
  const done = async () => { await vi.waitFor(() => expect(isInvestigating(investigation.get(server.id).run)).toBe(false), { timeout: 6000 }); return investigation.get(server.id) }
  return { servers, key, server, credential, operations, ai, investigation, commands, bodies, path, start, done, setInvalid: () => { invalid = true }, setForeign: () => { foreign = true }, setHold: () => { hold = true }, setEvil: () => { evil = true }, setMalformed: () => { malformed = true }, setTruncated: () => { truncated = true }, setBatch: () => { batch = true } }
}
describe('bounded server investigation', () => {
  it.each(['openai', 'anthropic'] as const)('collects, follows a clue with %s tools and persists an encrypted structured dossier', async provider => {
    const f = await fixture(provider); f.start(); const result = await f.done()
    expect(result.run?.state).toBe('completed'); expect(result.report?.content.applications[0].directories[0].path).toBe('/srv/fixture-web')
    expect(f.commands).toHaveLength(3); expect(f.bodies).toHaveLength(2)
    expect(JSON.stringify(f.bodies)).not.toContain('target-secret'); expect(JSON.stringify(f.bodies)).not.toContain('sk-syntheticsecret')
    expect(f.operations.listProfiles()).toHaveLength(0)
    const local = f.servers.store.db.prepare("SELECT tokenHash FROM profiles WHERE source='desktop-ai'").get()!
    f.servers.store.db.prepare("UPDATE profiles SET tokenHash=? WHERE source='desktop-ai'").run(createHash('sha256').update('a'.repeat(43)).digest('hex'))
    expect(() => f.operations.authenticate('a'.repeat(43))).toThrow(expect.objectContaining({ code: 'ACCESS_DENIED' })); expect(local.tokenHash).toBeTruthy()
    const raw = readFileSync(f.path); expect(raw.includes(Buffer.from('Fixture Web'))).toBe(false); expect(raw.includes(Buffer.from('/srv/fixture-web'))).toBe(false)
    const other = new InvestigationService(f.operations, f.ai); cleanup.push(() => other.close())
    expect(other.get(f.server.id).report).toEqual(result.report)
    f.servers.lock(); expect(() => other.get(f.server.id)).toThrow(expect.objectContaining({ code: 'VAULT_LOCKED' }))
  })
  it('requires approval for each collector and never dispatches a denied query', async () => {
    const f = await fixture('openai', false); f.start()
    await vi.waitFor(() => expect(f.investigation.get(f.server.id).run?.state).toBe('awaiting_approval'))
    expect(f.commands).toEqual([])
    const id = f.investigation.get(f.server.id).run!.operationId!
    f.operations.decide({ id, approve: false }); const result = await f.done()
    expect(result.run?.state).toBe('failed'); expect(f.commands).toHaveLength(0); expect(f.bodies).toHaveLength(0)
  })
  it('cancels pending approval, revokes desktop access and never retries', async () => {
    const f = await fixture('openai', false); f.start(); expect(() => f.start()).toThrow(expect.objectContaining({ code: 'INVESTIGATION_BUSY' }))
    f.investigation.cancel(f.server.id); await f.done()
    await new Promise(r => setTimeout(r, 40))
    expect(f.commands).toHaveLength(0)
    expect(f.servers.store.db.prepare("SELECT revokedAt FROM profiles WHERE source='desktop-ai'").get()?.revokedAt).toBeTypeOf('number')
  })
  it('preserves a successful dossier when a refresh has invalid tool output', async () => {
    const f = await fixture(); f.start(); const saved = (await f.done()).report
    f.setInvalid(); f.start(); const failed = await f.done()
    expect(failed.run?.state).toBe('failed'); expect(failed.run?.errorCode).toBe('AI_INFERENCE_RESPONSE'); expect(failed.report).toEqual(saved)
  })
  it('keeps the previous report if final report persistence fails', async () => {
    const f = await fixture(); f.start(); const saved = (await f.done()).report
    const original = f.servers.protect.bind(f.servers); let fail = true
    vi.spyOn(f.servers, 'protect').mockImplementation((context, data) => {
      if (fail && context.startsWith('server-dossier:') && JSON.parse(data.toString()).run?.state === 'completed') { fail = false; throw new AppError('STORAGE_FAILED') }
      return original(context, data)
    })
    f.start(); const view = await f.done()
    expect(view.run?.errorCode).toBe('STORAGE_FAILED'); expect(view.report).toEqual(saved)
  })
  it('never executes a model-supplied shell tool outside the catalog', async () => {
    const f = await fixture(); f.setEvil(); f.start(); const view = await f.done()
    expect(view.run?.errorCode).toBe('AI_INFERENCE_RESPONSE'); expect(f.commands).toHaveLength(2)
    expect(f.commands.some(c => c.includes('rm -rf'))).toBe(false)
  })
  it('rejects report references that are not successful collected evidence', async () => {
    const f = await fixture(); f.setForeign(); f.start(); const result = await f.done()
    expect(result.run?.errorCode).toBe('AI_EVIDENCE_INVALID'); expect(result.report).toBeNull()
  })
  it.each(['lock', 'ai-change', 'server-change', 'cancel'] as const)('aborts inference on %s without saving late output', async action => {
    const f = await fixture(); f.setHold(); f.start()
    await vi.waitFor(() => expect(f.bodies).toHaveLength(1), { timeout: 4000 })
    if (action === 'lock') f.servers.lock()
    else if (action === 'ai-change') f.ai.save({ revision: 1, provider: 'openai', baseUrl: 'https://fixture.test/anthropic', model: 'replacement-model' })
    else if (action === 'server-change') f.servers.saveCredential({ id: f.credential.id, name: 'fixture', kind: 'password', password: 'replacement-secret' })
    else f.investigation.cancel(f.server.id)
    await new Promise(r => setTimeout(r, 50))
    if (action === 'lock') f.servers.unlock(f.key)
    const view = f.investigation.get(f.server.id)
    expect(view.report).toBeNull(); expect(isInvestigating(view.run)).toBe(false); expect(f.commands).toHaveLength(2)
  })
  it('validates consent revisions, required AI settings and existing host trust before starting', async () => {
    const f = await fixture()
    expect(() => f.investigation.start({ serverId: f.server.id, serverRevision: 99, aiRevision: 1 })).toThrow(expect.objectContaining({ code: 'CONFIG_CHANGED' }))
    expect(() => f.investigation.start({ serverId: f.server.id, serverRevision: 1, aiRevision: 0 })).toThrow(expect.objectContaining({ code: 'AI_CHANGED' }))
    f.ai.remove({ revision: 1, provider: 'openai' }); expect(() => f.start()).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' }))
    expect(f.commands).toHaveLength(0)
  })
  it('tests the saved model with synthetic data without creating SSH operations', async () => {
    const f = await fixture('anthropic'); expect(await f.ai.probe({ revision: 1 })).toEqual({ success: true })
    expect(f.commands).toHaveLength(0); expect(f.operations.list()).toHaveLength(0)
  })
  it.each(['openai', 'anthropic'] as const)('handles a valid three-call %s batch sequentially, preserving dedup and all tool results', async provider => {
    const f = await fixture(provider); f.setBatch(); f.start(); const view = await f.done()
    expect(view.run?.state).toBe('completed'); expect(f.commands).toHaveLength(3)
    const second = f.bodies[1]
    if (provider === 'anthropic') expect(second.messages.at(-1).content).toHaveLength(3)
    else expect(second.messages.filter((m: any) => m.role === 'tool')).toHaveLength(3)
  })
  it('recovers truncated model output with a bounded compact report request and no repeated SSH', async () => {
    const f = await fixture('anthropic'); f.setTruncated(); f.start(); const view = await f.done()
    expect(view.run?.state).toBe('completed'); expect(f.commands).toHaveLength(2); expect(f.bodies).toHaveLength(2)
    expect(f.bodies[1].tools.map((t: any) => t.name)).toEqual(['save_report'])
  })
  it('repairs an invalid structured report using feedback without rerunning SSH', async () => {
    const f = await fixture('anthropic'); f.setMalformed(); f.start(); const view = await f.done()
    expect(view.run?.state).toBe('completed'); expect(f.commands).toHaveLength(3); expect(f.bodies).toHaveLength(3)
    expect(f.bodies[2].tools.map((t: any) => t.name)).toEqual(['save_report'])
    expect(f.bodies[2].messages.at(-1).content[0].is_error).toBe(true)
  })
  it('validates exactly the two baseline items without replacing an existing dossier or executing SSH', async () => {
    const f = await fixture(); f.start(); const before = await f.done(), count = f.commands.length
    expect(before.run?.evidence).toHaveLength(3)
    f.investigation.start({ serverId: f.server.id, serverRevision: f.server.revision, aiRevision: 1, reuseEvidence: true, baselineOnly: true })
    const after = await f.done()
    expect(after.run?.state).toBe('completed'); expect(after.run?.validationOnly).toBe(true)
    expect(after.run?.evidence.map(e => e.query)).toEqual(['overview', 'runtimes'])
    expect(after.report).toEqual(before.report); expect(f.commands).toHaveLength(count)
  })
  it('can synthesize retained baseline without reconnecting or executing additional queries', async () => {
    const f = await fixture(); f.setForeign(); f.start(); await f.done()
    const original = f.investigation.get(f.server.id).run!, count = f.commands.length
    // The fixture deliberately keeps returning invalid references; only AI retries are allowed.
    f.investigation.start({ serverId: f.server.id, serverRevision: f.server.revision, aiRevision: 1, reuseEvidence: true })
    const view = await f.done()
    expect(view.run?.sourceCollectedAt).toBe(original.startedAt); expect(f.commands).toHaveLength(count)
    expect(view.run?.evidence).toEqual(original.evidence)
  })
  it('persists manual corrections separately, strips inherited evidence and keeps untouched AI fields fresh', async () => {
    const f = await fixture(); f.start(); const before = await f.done(), count = f.commands.length, calls = f.bodies.length
    const content = structuredClone(before.report!.content)
    content.overview = 'Human maintained summary'; content.system.cpu.value = 'Manual CPU'; content.applications[0].name = 'Manual service'; content.disks[0].used = 'Manual disk usage'
    const edited = f.investigation.edit({ serverId: f.server.id, runId: before.report!.runId, revision: 0, content })
    expect(edited.report?.manualFields).toEqual(['overview', 'system.cpu', 'disks', 'applications'])
    expect(edited.report?.content.system.cpu).toEqual({ value: 'Manual CPU', confidence: 'unknown', evidenceIds: [] })
    expect(edited.report?.content.applications[0].evidenceIds).toEqual([])
    expect(edited.report?.content.applications[0].directories[0].evidenceIds).toEqual([])
    expect(edited.report?.content.disks[0].confidence).toBe('unknown')
    expect(f.commands).toHaveLength(count); expect(f.bodies).toHaveLength(calls)
    const row = f.servers.store.db.prepare('SELECT detail FROM server_dossiers WHERE serverId=?').get(f.server.id)!
    const plain = f.servers.reveal(`server-dossier:${f.server.id}`, row.detail as Uint8Array)
    const stored = JSON.parse(plain.toString()); plain.fill(0)
    expect(stored.report.content.overview).toBe(before.report!.content.overview)
    expect(readFileSync(f.path).includes(Buffer.from('Human maintained summary'))).toBe(false)
    f.start(); const refreshed = await f.done()
    expect(refreshed.report?.runId).not.toBe(before.report!.runId)
    expect(refreshed.report?.content.overview).toBe('Human maintained summary')
    expect(refreshed.report?.content.system.cpu.value).toBe('Manual CPU')
    expect(refreshed.report?.content.system.memory.evidenceIds).toEqual([refreshed.run!.evidence[0].id])
    f.servers.lock(); expect(() => f.investigation.get(f.server.id)).toThrowError(expect.objectContaining({ code: 'VAULT_LOCKED' })); f.servers.unlock(f.key)
    expect(f.investigation.get(f.server.id).report?.content.applications[0].name).toBe('Manual service')
  })
  it('rejects stale edits, forged evidence metadata, locked writes and editing during a refresh', async () => {
    const f = await fixture(); f.start(); const view = await f.done()
    const input = { serverId: f.server.id, runId: view.report!.runId, revision: 0, content: structuredClone(view.report!.content) }
    // Evidence-only mutations must not become part of the stored report.
    input.content.system.os.evidenceIds = [randomUUID()]; input.content.system.os.confidence = 'unknown'
    const updated = f.investigation.edit(input)
    expect(updated.report?.content.system.os).toEqual(view.report!.content.system.os)
    expect(updated.report?.manualFields).toEqual([])
    expect(() => f.investigation.edit(input)).toThrowError(expect.objectContaining({ code: 'CONTEXT_CHANGED' }))
    expect(() => f.investigation.edit({ ...input, revision: 1, runId: randomUUID() })).toThrowError(expect.objectContaining({ code: 'CONTEXT_CHANGED' }))
    f.servers.lock(); expect(() => f.investigation.edit({ ...input, revision: 1 })).toThrowError(expect.objectContaining({ code: 'VAULT_LOCKED' })); f.servers.unlock(f.key)
    f.setHold(); f.start()
    expect(() => f.investigation.edit({ ...input, revision: 1 })).toThrowError(expect.objectContaining({ code: 'INVESTIGATION_BUSY' }))
    f.investigation.cancel(f.server.id); await f.done()
  })
  it('keeps the saved report unchanged if correction persistence fails', async () => {
    const f = await fixture(); f.start(); const before = await f.done(), content = structuredClone(before.report!.content)
    content.overview = 'Must not persist'
    f.servers.store.db.exec("CREATE TRIGGER fail_correction BEFORE INSERT ON server_dossiers BEGIN SELECT RAISE(FAIL, 'synthetic'); END;")
    expect(() => f.investigation.edit({ serverId: f.server.id, runId: before.report!.runId, revision: 0, content })).toThrowError(expect.objectContaining({ code: 'STORAGE_FAILED' }))
    expect(f.investigation.get(f.server.id).report).toEqual(before.report)
    expect(f.investigation.get(f.server.id).corrections).toBeUndefined()
  })
  it('enforces discovered targets, rejects shell injection and never reads configs or process arguments', () => {
    const evidence = [{ id: randomUUID(), operationId: randomUUID(), query: 'runtimes', target: '', purpose: '', state: 'succeeded', errorCode: null, preview: '123 node\nfixture.service\nabcdef123456\n/srv/fixture-web', truncated: false }]
    for (const [query, target] of [['process','124'],['process','123; rm /'],['service','other.service'],['container','abcd12345678'],['directory','/etc'],['directory','/opt/../etc'],['directory','/srv/not-seen'],['directory','/root/.ssh']]) expect(() => queryCommand({ query: query as any, target, purpose: 'test' }, evidence)).toThrow(AppError)
    expect(queryCommand({ query: 'process', target: '123', purpose: 'test' }, evidence)).not.toMatch(/cmdline|environ/)
    expect(queryCommand({ query: 'container', target: 'abcdef123456', purpose: 'test' }, evidence)).not.toMatch(/\.Env|\.Cmd|\.Args/)
  })
})
