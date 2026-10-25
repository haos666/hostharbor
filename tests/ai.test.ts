import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AiService, normalizeAiUrl } from '../src/core/ai/service'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn() })
function setup(disk = false, timeout = 1000, fetcher?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'hh-ai-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const path = disk ? join(dir, 'test.sqlite') : ':memory:', servers = new ServerService(new Store(path)), key = randomBytes(32)
  servers.unlock(key); cleanups.push(() => servers.close())
  const ai = new AiService(servers, timeout, fetcher); cleanups.push(() => ai.close())
  return { ai, servers, path, key }
}
async function endpoint(handle: (req: import('node:http').IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handle); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  cleanups.push(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()) }))
  return `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
}
const input = { revision: 0, provider: 'openai' as const, baseUrl: 'https://example.test/v1', apiKey: 'synthetic-test-key', model: 'synthetic-model' }
describe('encrypted AI configuration and protocol adapters', () => {
  it('normalizes base paths and rejects credentials, query keys, remote HTTP and inference endpoints', () => {
    expect(normalizeAiUrl('https://example.test')).toBe('https://example.test/v1')
    expect(normalizeAiUrl('https://example.test/prefix/v1/')).toBe('https://example.test/prefix/v1')
    expect(normalizeAiUrl('http://[::1]:1234/v1')).toBe('http://[::1]:1234/v1')
    for (const url of ['http://example.test/v1','file:///tmp','https://user:key@example.test','https://example.test?api_key=x','https://example.test/#x','https://example.test/v1/models','https://example.test/v1/messages']) expect(() => normalizeAiUrl(url)).toThrow(expect.objectContaining({ code: 'AI_ADDRESS' }))
  })
  it('encrypts independent provider keys, never returns them, and restores after restart', () => {
    const f = setup(true), saved = f.ai.save(input)
    expect(saved.providers.openai).toEqual({ baseUrl: input.baseUrl, model: input.model, hasKey: true })
    const both = f.ai.save({ ...input, revision: saved.revision, provider: 'anthropic', apiKey: 'second-synthetic-key', model: 'synthetic-claude' })
    expect(both.providers.openai?.model).toBe(input.model); expect(both.activeProvider).toBe('anthropic')
    const raw = readFileSync(f.path)
    for (const secret of ['synthetic-test-key', 'second-synthetic-key', 'example.test', 'synthetic-claude']) expect(raw.includes(Buffer.from(secret))).toBe(false)
    expect(JSON.stringify(f.ai.get())).not.toContain('synthetic-test-key')
    const restored = new ServerService(new Store(f.path)); cleanups.push(() => restored.close())
    const restoredAi = new AiService(restored); cleanups.push(() => restoredAi.close())
    expect(() => restoredAi.get()).toThrow(expect.objectContaining({ code: 'VAULT_LOCKED' }))
    restored.unlock(f.key); expect(restoredAi.get()).toEqual(both)
  })
  it('retains a blank key only for the same address, refuses stale writes and removes one provider', () => {
    const { ai } = setup(); const saved = ai.save(input)
    expect(ai.save({ ...input, apiKey: undefined, revision: saved.revision, model: 'new-model' }).providers.openai?.model).toBe('new-model')
    expect(() => ai.save({ ...input, revision: 0 })).toThrow(expect.objectContaining({ code: 'AI_CHANGED' }))
    expect(() => ai.save({ ...input, revision: 2, apiKey: undefined, baseUrl: 'https://other.test/v1' })).toThrow(expect.objectContaining({ code: 'AI_KEY_REQUIRED' }))
    ai.save({ ...input, provider: 'anthropic', revision: 2 })
    const removed = ai.remove({ provider: 'openai', revision: 3 })
    expect(removed.providers.openai).toBeNull(); expect(removed.providers.anthropic?.hasKey).toBe(true)
    expect(ai.remove({ provider: 'anthropic', revision: 4 }).activeProvider).toBeNull()
  })
  it('sends OpenAI Bearer auth only to the configured models endpoint and filters bad/secret rows', async () => {
    let hits = 0
    const baseUrl = await endpoint((req, res) => {
      hits++; expect(req.url).toBe('/prefix/v1/models'); expect(req.method).toBe('GET')
      expect(req.headers.authorization).toBe('Bearer synthetic-test-key'); expect(req.headers['x-api-key']).toBeUndefined()
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ data: [{ id:'model-b' },{ id:'model-a' },{ id:'model-a' },{ id:'synthetic-test-key' },{ id:'safe-id',display_name:'synthetic-test-key' },{ id:7 }] }))
    })
    const { ai } = setup(), result = await ai.models({ revision:0,provider:'openai',apiKey:input.apiKey,baseUrl:`${baseUrl}/prefix/v1` })
    expect(result.models).toEqual([{ id:'model-b',name:'model-b' },{ id:'model-a',name:'model-a' },{ id:'safe-id',name:'safe-id' }]); expect(hits).toBe(1)
    expect(ai.get().providers.openai).toBeNull() // testing never saves credentials
  })
  it('uses Anthropic headers and bounded cursor pagination', async () => {
    let calls = 0
    const baseUrl = await endpoint((req, res) => {
      calls++; expect(req.headers['x-api-key']).toBe(input.apiKey); expect(req.headers['anthropic-version']).toBe('2023-06-01'); expect(req.headers.authorization).toBeUndefined()
      if (calls === 1) { expect(req.url).toBe('/v1/models?limit=100'); res.end(JSON.stringify({ data:[{id:'claude-fixture-a',display_name:'Fixture A'}],has_more:true,last_id:'claude-fixture-a' })) }
      else { expect(req.url).toContain('after_id=claude-fixture-a'); res.end(JSON.stringify({ data:[{id:'claude-fixture-b'}],has_more:false })) }
    })
    const { ai } = setup(); const result = await ai.models({ revision:0,provider:'anthropic',apiKey:input.apiKey,baseUrl })
    expect(result.models.map((m) => m.id)).toEqual(['claude-fixture-a','claude-fixture-b']); expect(calls).toBe(2)
  })
  it.each(['/anthropic', '/anthropic/v1', '/prefix/anthropic/'])('resolves versioned Anthropic gateway models from %s with saved keys', async (path) => {
    const baseUrl = await endpoint((req, res) => {
      expect(req.url).toBe(`${path.startsWith('/prefix') ? '/prefix' : ''}/anthropic/v1/models?limit=100`)
      expect(req.headers['x-api-key']).toBe(input.apiKey)
      res.end(JSON.stringify({ data: [{ id: 'fixture-model' }], has_more: false }))
    })
    const { ai } = setup()
    ai.save({ ...input, provider: 'anthropic', baseUrl: `${baseUrl}${path}` })
    const result = await ai.models({ revision: 1, provider: 'anthropic', baseUrl: `${baseUrl}${path}` })
    expect(result.models).toEqual([{ id: 'fixture-model', name: 'fixture-model' }])
    expect(ai.get().providers.anthropic?.baseUrl).toBe(`${baseUrl}${path.replace(/\/$/, '')}`)
  })
  it('bounds pages/model count and signals partial lists', async () => {
    const { ai } = setup(false,1000,vi.fn(async () => new Response(JSON.stringify({ data:Array.from({length:600},(_,i)=>({id:`model-${i}`})) }))) as typeof fetch)
    const result = await ai.models({ revision:0,provider:'openai',baseUrl:input.baseUrl,apiKey:input.apiKey })
    expect(result.models).toHaveLength(500); expect(result.truncated).toBe(true)
  })
  it.each([401,403,404,405,429,500])('maps %s safely without exposing provider bodies or keys', async (status) => {
    const baseUrl = await endpoint((_req,res) => { res.writeHead(status); res.end('synthetic-test-key sensitive provider error') })
    const { ai } = setup(); await expect(ai.models({ revision:0,provider:'openai',apiKey:input.apiKey,baseUrl })).rejects.toMatchObject({ code: status === 401 || status === 403 ? 'AI_AUTH' : status === 404 || status === 405 ? 'AI_MODELS_UNSUPPORTED' : status === 429 ? 'AI_RATE_LIMIT' : 'AI_UNAVAILABLE' })
  })
  it('rejects redirects without forwarding the key to another endpoint', async () => {
    let leaked = false
    const destination = await endpoint((_req,res) => { leaked = true; res.end('{}') })
    const baseUrl = await endpoint((_req,res) => { res.writeHead(302,{Location:destination});res.end() })
    const { ai } = setup(); await expect(ai.models({ revision:0,provider:'openai',apiKey:input.apiKey,baseUrl })).rejects.toMatchObject({ code:'AI_UNAVAILABLE' }); expect(leaked).toBe(false)
  })
  it('aborts a slow response on timeout, lock or configuration change and enforces concurrency', async () => {
    const baseUrl = await endpoint((_req,_res) => {})
    const timed = setup(false,50)
    await expect(timed.ai.models({revision:0,provider:'openai',baseUrl,apiKey:input.apiKey})).rejects.toMatchObject({code:'AI_TIMEOUT'})
    const locked = setup(), args = {revision:0,provider:'openai',baseUrl,apiKey:input.apiKey}
    const first = locked.ai.models(args), second = locked.ai.models(args)
    const assertion1 = expect(first).rejects.toMatchObject({code:'VAULT_LOCKED'}), assertion2 = expect(second).rejects.toMatchObject({code:'VAULT_LOCKED'})
    await expect(locked.ai.models(args)).rejects.toMatchObject({code:'AI_BUSY'}); locked.servers.lock(); await assertion1; await assertion2
    const changed = setup(), pending = changed.ai.models(args), rejected = expect(pending).rejects.toMatchObject({code:'AI_CHANGED'})
    changed.ai.save({...input,baseUrl}); await rejected
  })
  it.each(['not json',JSON.stringify({error:'sensitive'}),JSON.stringify({data:[{id:'x'}],has_more:true,last_id:'x'.repeat(300)})])('rejects malformed model responses', async (body) => {
    const baseUrl = await endpoint((_req,res) => res.end(body)), { ai } = setup()
    await expect(ai.models({revision:0,provider:'anthropic',baseUrl,apiKey:input.apiKey})).rejects.toMatchObject({code:'AI_RESPONSE'})
  })
  it('bounds response bytes and rejects header injection or persistence failure', async () => {
    const baseUrl = await endpoint((_req,res) => res.end('x'.repeat(2097153))), { ai,servers } = setup()
    await expect(ai.models({revision:0,provider:'openai',baseUrl,apiKey:input.apiKey})).rejects.toMatchObject({code:'AI_RESPONSE'})
    expect(() => ai.save({...input,apiKey:'key\r\nInjected: true'})).toThrow(expect.objectContaining({code:'INVALID_INPUT'}))
    servers.store.db.exec("CREATE TRIGGER fail_ai BEFORE UPDATE ON ai_settings BEGIN SELECT RAISE(ABORT,'synthetic'); END")
    expect(() => ai.save(input)).toThrow(expect.objectContaining({code:'STORAGE_FAILED'})); expect(ai.get().revision).toBe(0)
  })
})
