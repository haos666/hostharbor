import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { dossierSchema } from '../../shared/dossier'
import { instructions, tools as investigationTools } from '../investigation/protocol'
import { querySchema, queryCommand } from '../investigation/tools'
import { inferenceBody, parseInference, type AiMessage, type AiTool } from './inference'
import type { AiConnectionInput, AiModelList, AiSettings, AiProtocol } from '../../shared/contracts'
import { AppError, type ErrorCode } from '../../shared/errors'
import { parse } from '../validation'
import type { ServerService } from '../servers/service'
const protocol = z.enum(['openai', 'anthropic'])
const revision = z.number().int().nonnegative().safe()
const keySchema = z.string().trim().min(1).max(8192).regex(/^[\x21-\x7e]+$/)
const modelSchema = z.string().trim().min(1).max(256).refine((s) => !/[\x00-\x1f\x7f]/.test(s))
const connectionSchema = z.object({ revision, provider: protocol, baseUrl: z.string().trim().min(1).max(2048), apiKey: keySchema.optional() }).strict()
const providerSchema = z.object({ baseUrl: z.string(), model: modelSchema, apiKey: keySchema }).strict()
const savedSchema = z.object({ revision, activeProvider: protocol.nullable(), providers: z.object({ openai: providerSchema.nullable(), anthropic: providerSchema.nullable() }).strict() }).strict()
type Saved = z.infer<typeof savedSchema>
export function normalizeAiUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw new Error()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/v1'
    if (/\/(models|messages|responses|chat\/completions)$/.test(url.pathname)) throw new Error()
    return url.toString().replace(/\/$/, '')
  } catch { throw new AppError('AI_ADDRESS') }
}
export class AiService {
  readonly changed = new Set<() => void>()
  private requests = new Set<AbortController>()
  private readonly invalidated = (code: ErrorCode) => this.abort(code === 'VAULT_LOCKED' ? code : 'AI_CHANGED')
  constructor(private servers: ServerService, private timeoutMs = 15000, private fetcher: typeof fetch = fetch) { servers.invalidated.add(this.invalidated) }
  private get db() { return this.servers.store.db }
  private abort(code: ErrorCode) { for (const request of this.requests) request.abort(new AppError(code)) }
  private load(): Saved {
    this.servers.assertUnlocked()
    const row = this.db.prepare('SELECT revision,detail FROM ai_settings WHERE id=1').get()
    if (!row) throw new AppError('STORAGE_FAILED')
    if (row.revision === 0 && row.detail === null) return { revision: 0, activeProvider: null, providers: { openai: null, anthropic: null } }
    const plain = this.servers.reveal('ai-settings:v1', row.detail as Uint8Array)
    try {
      const config = savedSchema.parse(JSON.parse(plain.toString()))
      if (config.revision !== row.revision || (config.activeProvider && !config.providers[config.activeProvider])) throw new Error()
      for (const entry of Object.values(config.providers)) if (entry && normalizeAiUrl(entry.baseUrl) !== entry.baseUrl) throw new Error()
      return config
    } catch { throw new AppError('STORAGE_FAILED') } finally { plain.fill(0) }
  }
  private summary(config: Saved): AiSettings {
    const publicProvider = (p: Saved['providers'][AiProtocol]) => p ? { baseUrl: p.baseUrl, model: p.model, hasKey: true } : null
    return { revision: config.revision, activeProvider: config.activeProvider, providers: { openai: publicProvider(config.providers.openai), anthropic: publicProvider(config.providers.anthropic) } }
  }
  get(): AiSettings { return this.summary(this.load()) }
  private resolve(input: AiConnectionInput) {
    const config = this.load(), baseUrl = normalizeAiUrl(input.baseUrl)
    if (config.revision !== input.revision) throw new AppError('AI_CHANGED')
    const old = config.providers[input.provider]
    const apiKey = input.apiKey ?? (old?.baseUrl === baseUrl ? old.apiKey : undefined)
    if (!apiKey) throw new AppError('AI_KEY_REQUIRED')
    return { config, baseUrl, apiKey }
  }
  private persist(next: Saved): AiSettings {
    const plain = Buffer.from(JSON.stringify(next))
    try {
      const result = this.db.prepare('UPDATE ai_settings SET revision=?,detail=? WHERE id=1 AND revision=?').run(next.revision, this.servers.protect('ai-settings:v1', plain), next.revision - 1)
      if (result.changes !== 1) throw new AppError('AI_CHANGED')
    } catch (e) { throw e instanceof AppError ? e : new AppError('STORAGE_FAILED') } finally { plain.fill(0) }
    this.abort('AI_CHANGED')
    for (const notify of this.changed) notify()
    return this.summary(next)
  }
  save(raw: unknown): AiSettings {
    const input = parse(connectionSchema.extend({ model: modelSchema }), raw), { config, baseUrl, apiKey } = this.resolve(input)
    return this.persist({ revision: config.revision + 1, activeProvider: input.provider, providers: { ...config.providers, [input.provider]: { baseUrl, apiKey, model: input.model } } })
  }
  remove(raw: unknown): AiSettings {
    const input = parse(z.object({ revision, provider: protocol }).strict(), raw), config = this.load()
    if (input.revision !== config.revision) throw new AppError('AI_CHANGED')
    return this.persist({ revision: config.revision + 1, activeProvider: config.activeProvider === input.provider ? null : config.activeProvider, providers: { ...config.providers, [input.provider]: null } })
  }
  async models(raw: unknown): Promise<AiModelList> {
    const input = parse(connectionSchema, raw), { config, baseUrl, apiKey } = this.resolve(input)
    if (this.requests.size >= 2) throw new AppError('AI_BUSY')
    const controller = new AbortController(); this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(new AppError('AI_TIMEOUT')), this.timeoutMs)
    const check = () => { controller.signal.throwIfAborted(); this.servers.assertUnlocked(); if (this.load().revision !== config.revision) throw new AppError('AI_CHANGED') }
    try {
      const models: AiModelList['models'] = [], ids = new Set<string>(); let after = '', truncated = false, bytes = 0
      for (let page = 0; page < 5; page++) {
        check()
        // Anthropic-compatible gateways commonly advertise an /anthropic base;
        // their versioned resources still live below /anthropic/v1.
        const resourceBase = input.provider === 'anthropic' && new URL(baseUrl).pathname.endsWith('/anthropic') ? `${baseUrl}/v1` : baseUrl
        const url = new URL(`${resourceBase}/models`)
        if (input.provider === 'anthropic') { url.searchParams.set('limit', '100'); if (after) url.searchParams.set('after_id', after) }
        const headers: Record<string, string> = input.provider === 'openai' ? { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', Accept: 'application/json' }
        const response = await this.fetcher(url, { method: 'GET', headers, signal: controller.signal, redirect: 'error', credentials: 'omit' })
        if (!response.ok) { await response.body?.cancel(); throw new AppError(response.status === 401 || response.status === 403 ? 'AI_AUTH' : response.status === 404 || response.status === 405 ? 'AI_MODELS_UNSUPPORTED' : response.status === 429 ? 'AI_RATE_LIMIT' : 'AI_UNAVAILABLE') }
        const reader = response.body?.getReader(); if (!reader) throw new AppError('AI_RESPONSE')
        const chunks: Uint8Array[] = []
        try { while (true) { const chunk = await reader.read(); check(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 2097152) throw new AppError('AI_RESPONSE'); chunks.push(chunk.value) } }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        let body: { data?: unknown; has_more?: unknown; last_id?: unknown }
        try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new AppError('AI_RESPONSE') }
        if (!body || !Array.isArray(body.data) || body.data.length > 10000) throw new AppError('AI_RESPONSE')
        for (const entry of body.data) {
          if (!entry || typeof entry !== 'object') continue
          const item = entry as { id?: unknown; display_name?: unknown }
          const parsed = modelSchema.safeParse(item.id)
          if (!parsed.success || parsed.data.includes(apiKey) || ids.has(parsed.data)) continue
          const label = modelSchema.safeParse(item.display_name)
          ids.add(parsed.data); models.push({ id: parsed.data, name: label.success && !label.data.includes(apiKey) ? label.data : parsed.data })
          if (models.length >= 500) { truncated = true; break }
        }
        if (input.provider !== 'anthropic' || body.has_more !== true || truncated) break
        if (typeof body.last_id !== 'string' || !modelSchema.safeParse(body.last_id).success || body.last_id === after || body.last_id.includes(apiKey)) throw new AppError('AI_RESPONSE')
        after = body.last_id; if (page === 4) truncated = true
      }
      check(); return { models, truncated }
    } catch (e) { if (controller.signal.aborted && controller.signal.reason instanceof AppError) throw controller.signal.reason; throw e instanceof AppError ? e : new AppError('AI_UNAVAILABLE') }
    finally { clearTimeout(timer); this.requests.delete(controller) }
  }
  async infer(expectedRevision: number, system: string, messages: AiMessage[], tools: AiTool[], signal: AbortSignal) {
    const config = this.load(), provider = config.activeProvider
    if (config.revision !== expectedRevision) throw new AppError('AI_CHANGED')
    if (!provider || !config.providers[provider]) throw new AppError('AI_NOT_CONFIGURED')
    if (this.requests.size >= 2) throw new AppError('AI_BUSY')
    const entry = config.providers[provider]!, controller = new AbortController()
    const abort = () => controller.abort(signal.reason); signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    this.requests.add(controller)
    const timer = setTimeout(() => controller.abort(new AppError('AI_TIMEOUT')), 60000)
    try {
      const base = provider === 'anthropic' && new URL(entry.baseUrl).pathname.endsWith('/anthropic') ? `${entry.baseUrl}/v1` : entry.baseUrl
      const headers: Record<string, string> = provider === 'openai' ? { Authorization: `Bearer ${entry.apiKey}` } : { 'x-api-key': entry.apiKey, 'anthropic-version': '2023-06-01' }
      const body = JSON.stringify(inferenceBody(provider, entry.model, system, messages, tools))
      if (Buffer.byteLength(body) > 524288) throw new AppError('AI_BUDGET')
      const response = await this.fetcher(`${base}/${provider === 'anthropic' ? 'messages' : 'chat/completions'}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body, signal: controller.signal, redirect: 'error', credentials: 'omit' })
      if (!response.ok) { await response.body?.cancel(); throw new AppError(response.status === 401 || response.status === 403 ? 'AI_AUTH' : response.status === 429 ? 'AI_RATE_LIMIT' : 'AI_INFERENCE_FAILED') }
      const reader = response.body?.getReader(); if (!reader) throw new AppError('AI_INFERENCE_RESPONSE')
      const chunks: Uint8Array[] = []; let size = 0
      try { while (true) { const c = await reader.read(); controller.signal.throwIfAborted(); if (c.done) break; size += c.value.byteLength; if (size > 1048576) throw new AppError('AI_INFERENCE_RESPONSE'); chunks.push(c.value) } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      this.servers.assertUnlocked(); controller.signal.throwIfAborted()
      if (this.load().revision !== expectedRevision) throw new AppError('AI_CHANGED')
      const text = Buffer.concat(chunks).toString()
      if (text.includes(entry.apiKey)) throw new AppError('AI_INFERENCE_RESPONSE')
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { throw new AppError('AI_INFERENCE_RESPONSE') }
      return parseInference(provider, parsed)
    } catch (e) {
      if (controller.signal.aborted && controller.signal.reason instanceof AppError) throw controller.signal.reason
      throw e instanceof AppError ? e : new AppError('AI_INFERENCE_FAILED')
    } finally { clearTimeout(timer); this.requests.delete(controller); signal.removeEventListener('abort', abort) }
  }
  async probe(raw: unknown): Promise<{ success: true }> {
    const { revision: expected } = parse(z.object({ revision }).strict(), raw)
    const evidence = [
      { id: randomUUID(), operationId: randomUUID(), query: 'overview', target: '', purpose: '合成系统测试', state: 'succeeded', exitCode: 0, errorCode: null, preview: 'Linux Synthetic OS\nCPU: 4 cores\nMemory: total 8 GiB, used 2 GiB\nDisk /: 100 GiB, used 28 GiB\nUptime: 3 days', truncated: false },
      { id: randomUUID(), operationId: randomUUID(), query: 'runtimes', target: '', purpose: '合成服务测试', state: 'succeeded', exitCode: 0, errorCode: null, preview: '123 node\nfixture.service\nListen: 8080/tcp', truncated: false },
    ]
    const messages: AiMessage[] = [{ role: 'user', text: JSON.stringify({ instruction: '这是纯合成能力测试，不连接服务器。先调用 investigate 查询 PID 123 的工作目录；收到结果后调用 save_report。', evidence }) }]
    const signal = new AbortController().signal
    const first = await this.infer(expected, instructions, messages, [investigationTools[0]], signal)
    if (first.calls.length !== 1 || first.calls[0].name !== 'investigate') throw new AppError('AI_TOOL_FORMAT')
    const query = querySchema.safeParse(first.calls[0].input)
    if (!query.success) throw new AppError('AI_TOOL_FORMAT')
    queryCommand(query.data, evidence) // Validate scope, but never execute it.
    const followup = { ...evidence[1], id: randomUUID(), query: query.data.query, target: query.data.target, purpose: '合成跟进结果', preview: '[executable]\n/usr/bin/node\n[working-directory]\n/srv/fixture-web' }
    messages.push({ role: 'assistant', calls: first.calls, ...(first.anthropicContent ? { anthropicContent: first.anthropicContent } : {}) }, { role: 'results', results: [{ id: first.calls[0].id, value: followup }] })
    const last = await this.infer(expected, instructions, messages, [investigationTools[1]], signal)
    if (last.calls.length !== 1 || last.calls[0].name !== 'save_report') throw new AppError('AI_TOOL_FORMAT')
    const report = dossierSchema.safeParse(last.calls[0].input)
    if (!report.success) throw new AppError('AI_REPORT_FORMAT')
    const ids = new Set<string>([...evidence, followup].map(e => e.id))
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const obj = value as Record<string, unknown>
      if (Array.isArray(obj.evidenceIds) && (obj.evidenceIds.some(id => !ids.has(String(id))) || (obj.confidence !== 'unknown' && !obj.evidenceIds.length))) throw new AppError('AI_EVIDENCE_INVALID')
      for (const child of Object.values(obj)) if (Array.isArray(child)) child.forEach(visit); else visit(child)
    }
    visit(report.data)
    return { success: true }
  }
  close() { this.abort('CORE_UNAVAILABLE'); this.servers.invalidated.delete(this.invalidated) }
}
