import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { dossierSchema, dossierCorrectionsSchema, effectiveDossier, systemFields, isInvestigating, type InvestigationView, type InvestigationRun, type InvestigationEvidence } from '../../shared/dossier'
import { AppError, type ErrorCode } from '../../shared/errors'
import { idSchema, parse } from '../validation'
import type { AiService } from '../ai/service'
import { AiProtocolError, type AiMessage } from '../ai/inference'
import type { OperationService } from '../operations/service'
import { instructions, tools } from './protocol'
import { queryCommand, querySchema, type Query } from './tools'
const terminal = new Set(['succeeded', 'failed', 'denied', 'interrupted', 'unknown', 'expired'])
export class InvestigationService {
  private active: { serverId: string; controller: AbortController } | null = null
  private readonly invalidated = (code: ErrorCode) => this.active?.controller.abort(new AppError(code))
  private readonly aiChanged = () => this.invalidated('AI_CHANGED')
  constructor(private operations: OperationService, private ai: AiService, private pollMs = 500) {
    operations.servers.invalidated.add(this.invalidated); ai.changed.add(this.aiChanged)
  }
  private get servers() { return this.operations.servers }
  private load(serverId: string): InvestigationView {
    this.servers.assertUnlocked()
    if (!this.servers.store.getServer(serverId)) throw new AppError('NOT_FOUND')
    const row = this.servers.store.db.prepare('SELECT detail FROM server_dossiers WHERE serverId=?').get(serverId)
    if (!row) return { run: null, report: null }
    const plain = this.servers.reveal(`server-dossier:${serverId}`, row.detail as Uint8Array)
    try {
      if (plain.length > 524288) throw new Error()
      const view = JSON.parse(plain.toString()) as InvestigationView
      if (view.report) dossierSchema.parse(view.report.content)
      if (view.corrections) dossierCorrectionsSchema.parse(view.corrections)
      if (!view || !('run' in view) || !('report' in view)) throw new Error()
      return view
    } catch { throw new AppError('STORAGE_FAILED') } finally { plain.fill(0) }
  }
  private save(serverId: string, view: InvestigationView) {
    const plain = Buffer.from(JSON.stringify(view))
    try {
      if (plain.length > 524288) throw new AppError('AI_BUDGET')
      this.servers.store.db.prepare('INSERT INTO server_dossiers(serverId,detail) VALUES(?,?) ON CONFLICT(serverId) DO UPDATE SET detail=excluded.detail').run(serverId, this.servers.protect(`server-dossier:${serverId}`, plain))
    } catch (e) { throw e instanceof AppError ? e : new AppError('STORAGE_FAILED') } finally { plain.fill(0) }
  }
  get(raw: unknown): InvestigationView {
    const serverId = parse(idSchema, raw), view = this.load(serverId)
    if (isInvestigating(view.run) && this.active?.serverId !== serverId) {
      view.run = { ...view.run!, state: 'interrupted', stage: '调查已中断，不会自动重试', operationId: null, errorCode: 'CORE_UNAVAILABLE', updatedAt: Date.now() }; this.save(serverId, view)
    }
    if (view.report) {
      try { view.report.stale = view.report.snapshot !== this.operations.snapshot(serverId).snapshot }
      catch { view.report.stale = true }
    }
    return effectiveDossier(view)
  }
  edit(raw: unknown): InvestigationView {
    const input = parse(z.object({ serverId: idSchema, runId: idSchema, revision: z.number().int().min(0), content: dossierSchema }).strict(), raw)
    const view = this.load(input.serverId)
    if (isInvestigating(view.run) && this.active?.serverId === input.serverId) throw new AppError('INVESTIGATION_BUSY')
    if (!view.report || view.report.runId !== input.runId || (view.corrections?.revision ?? 0) !== input.revision) throw new AppError('CONTEXT_CHANGED')
    const current = effectiveDossier(view).report!.content, values = structuredClone(view.corrections?.values ?? {})
    if (input.content.overview !== current.overview) values.overview = input.content.overview
    for (const { key } of systemFields) if (input.content.system[key].value !== current.system[key].value) { values.system ??= {}; values.system[key] = input.content.system[key].value }
    // Never reuse machine evidence for human-authored values. Metadata is owned by Core.
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === 'confidence' ? 'unknown' : key === 'evidenceIds' ? [] : strip(child)]))
      return value
    }
    for (const key of ['disks', 'applications', 'unknowns'] as const) if (JSON.stringify(strip(input.content[key])) !== JSON.stringify(strip(current[key]))) Object.assign(values, { [key]: strip(input.content[key]) })
    view.corrections = dossierCorrectionsSchema.parse({ revision: input.revision + 1, updatedAt: Date.now(), values })
    this.save(input.serverId, view)
    return this.get(input.serverId)
  }
  start(raw: unknown): InvestigationView {
    const input = parse(z.object({ serverId: idSchema, serverRevision: z.number().int(), aiRevision: z.number().int(), reuseEvidence: z.boolean().optional(), baselineOnly: z.boolean().optional() }).strict(), raw)
    if (this.active) throw new AppError('INVESTIGATION_BUSY')
    const server = this.servers.listServers().find(s => s.id === input.serverId)
    if (!server || server.revision !== input.serverRevision) throw new AppError('CONFIG_CHANGED')
    const config = this.ai.get(), provider = config.activeProvider, entry = provider && config.providers[provider]
    if (config.revision !== input.aiRevision) throw new AppError('AI_CHANGED')
    if (!provider || !entry) throw new AppError('AI_NOT_CONFIGURED')
    const snapshot = this.operations.snapshot(server.id).snapshot, view = this.load(server.id)
    if (input.reuseEvidence && (!view.run || view.run.serverRevision !== server.revision || view.run.evidence.length < 2)) throw new AppError('CONFIG_CHANGED')
    if (input.baselineOnly && !input.reuseEvidence) throw new AppError('INVALID_INPUT')
    const retained = input.baselineOnly ? view.run!.evidence.filter(e => e.query === 'overview' || e.query === 'runtimes') : view.run?.evidence
    if (input.baselineOnly && retained?.length !== 2) throw new AppError('CONFIG_CHANGED')
    const run: InvestigationRun = { validationOnly: !!(input.baselineOnly && view.report), id: randomUUID(), serverRevision: server.revision, startedAt: Date.now(), updatedAt: Date.now(), provider, model: entry.model, destination: entry.baseUrl, state: 'collecting', stage: '准备基础查询', errorCode: null, operationId: null, evidence: input.reuseEvidence ? retained! : [], ...(input.reuseEvidence ? { sourceCollectedAt: view.run!.sourceCollectedAt ?? view.run!.startedAt } : {}) }
    const profileId = this.operations.desktopProfile(server.id), controller = new AbortController()
    try { this.save(server.id, { ...view, run }) } catch (e) { this.operations.releaseDesktopProfile(profileId); throw e }
    this.active = { serverId: server.id, controller }
    void this.run(server.id, { ...view, run }, profileId, snapshot, config.revision, controller, input.reuseEvidence === true).catch(() => {}).finally(() => { try { this.operations.releaseDesktopProfile(profileId) } finally { if (this.active?.controller === controller) this.active = null } }).catch(() => {})
    return this.get(server.id)
  }
  cancel(raw: unknown): InvestigationView {
    const id = parse(idSchema, raw), view = this.load(id)
    if (this.active?.serverId === id && view.run) {
      this.active.controller.abort(new AppError('CANCEL_REQUESTED'))
      if (view.run.operationId) this.operations.cancel(view.run.operationId)
      view.run.state = 'cancelled'; view.run.stage = '已停止调查'; view.run.errorCode = 'CANCEL_REQUESTED'; view.run.updatedAt = Date.now(); this.save(id, view)
    }
    return this.get(id)
  }
  private async run(serverId: string, view: InvestigationView, profileId: string, snapshot: string, aiRevision: number, controller: AbortController, reuseEvidence = false) {
    const run = view.run!, previousReport = view.report, timer = setTimeout(() => controller.abort(new AppError('AI_BUDGET')), 600000)
    const check = () => {
      controller.signal.throwIfAborted(); this.servers.assertUnlocked()
      if (this.ai.get().revision !== aiRevision) throw new AppError('AI_CHANGED')
      if (this.operations.snapshot(serverId).snapshot !== snapshot) throw new AppError('CONFIG_CHANGED')
    }
    const update = (state: InvestigationRun['state'], stage: string) => { check(); if (run.state === state && run.stage === stage) return; run.state = state; run.stage = stage; run.updatedAt = Date.now(); this.save(serverId, view) }
    const seen = new Set<string>(); let totalChars = 0
    const collect = async (query: Query) => {
      check()
      const key = `${query.query}:${query.target}`
      if (seen.has(key)) return { error: '此查询已执行，请使用已有证据，不会重复执行。' }
      if (run.evidence.length >= 10 || totalChars >= 64000) return { error: '查询预算已耗尽，请提交报告并列出未知事项。' }
      const command = queryCommand(query, run.evidence); seen.add(key)
      update('collecting', query.purpose)
      const operation = this.operations.start(profileId, { serverId, requestKey: `${run.id}:${run.evidence.length}`, command, cwd: '/', timeoutMs: 15000, connectTimeoutMs: 12000 })
      run.operationId = operation.id; this.save(serverId, view)
      const cancel = () => { try { if (this.servers.vaultState === 'unlocked') this.operations.cancel(operation.id) } catch {} }
      controller.signal.addEventListener('abort', cancel, { once: true })
      try {
        let current = operation
        while (!terminal.has(current.state)) {
          update(current.state === 'awaiting_approval' ? 'awaiting_approval' : 'collecting', current.state === 'awaiting_approval' ? `等待你批准：${query.purpose}` : query.purpose)
          await delay(this.pollMs, undefined, { signal: controller.signal }); check(); current = this.operations.get(operation.id, profileId)
        }
        check()
        // Rejection/uncertain execution halts this run instead of eliciting a bypass query.
        if (current.state !== 'succeeded' && current.state !== 'failed') throw new AppError((current.errorCode as ErrorCode | null) ?? 'OPERATION_STATE')
        const chunks: string[] = []; let cursor = 0, length = 0, truncated = false
        while (true) {
          const page = this.operations.read(operation.id, cursor, profileId)
          if (page.replayClearedAt) throw new AppError('OPERATION_REMOVED')
          if (!page.chunks.length) break
          for (const chunk of page.chunks) {
            const room = Math.min(12000 - length, 64000 - totalChars)
            if (chunk.text.length > room) truncated = true
            const part = chunk.text.slice(0, Math.max(0, room)); chunks.push(part); length += part.length; totalChars += part.length
          }
          cursor = page.nextCursor
          if (truncated) break
        }
        // OperationService already redacts known SSH secrets. Apply a second bounded scrub
        // for common accidental tokens before any data leaves the device.
        const preview = chunks.join('').replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}\b/g, '[已隐藏]').replace(/\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[已隐藏]')
        const evidence: InvestigationEvidence = { id: randomUUID(), operationId: operation.id, query: query.query, target: query.target, purpose: query.purpose, state: current.state, exitCode: current.exitCode, errorCode: current.errorCode, preview, truncated }
        run.evidence.push(evidence); run.operationId = null; this.save(serverId, view); return evidence
      } finally { controller.signal.removeEventListener('abort', cancel); if (controller.signal.aborted) cancel() }
    }
    try {
      if (!reuseEvidence) {
        const baseline = await collect({ query: 'overview', target: '', purpose: '采集系统、CPU、内存和磁盘' })
        if (!('preview' in baseline) || !/\bLinux\b/.test(baseline.preview)) throw new AppError('INVESTIGATION_PLATFORM')
        await collect({ query: 'runtimes', target: '', purpose: '查找运行服务、监听端口和容器' })
      }
      const messages: AiMessage[] = [{ role: 'user', text: JSON.stringify({ instruction: reuseEvidence ? '只整理已有历史采集，不允许新增查询。仅调用 save_report，缺失项写未知，不将历史数据说成当前状态。' : '请根据基础证据调查并提交档案。最多8次跟进查询、7次模型请求，缺失项写未知。', evidence: run.evidence }) }]
      let reportOnly = reuseEvidence, repairs = 0
      for (let round = 0; round < 7; round++) {
        update('analyzing', `AI 分析证据 · 第 ${round + 1} 轮`)
        let turn
        try { turn = await this.ai.infer(aiRevision, instructions, messages, reportOnly || round === 6 || run.evidence.length >= 10 || totalChars >= 64000 ? [tools[1]] : tools, controller.signal) }
        catch (e) {
          if (!(e instanceof AppError) || !['AI_OUTPUT_TRUNCATED', 'AI_NO_TOOL_CALL'].includes(e.code) || round === 6 || repairs++ >= 2) throw e
          reportOnly = true
          messages.push({ role: 'user', text: '上一次输出被截断或没有调用工具，未执行任何新查询。只调用 save_report 提交紧凑报告：概述一句，资源值精简，应用最多12项、每应用目录最多3个、端口最多6个。其余信息写入 unknowns，保留证据 UUID，不输出长篇分析。' })
          continue
        }
        check()
        messages.push({ role: 'assistant', calls: turn.calls, ...(turn.anthropicContent ? { anthropicContent: turn.anthropicContent } : {}) })
        if (turn.calls.some(c => c.name === 'save_report')) {
          if (turn.calls.length !== 1) {
            if (round === 6 || repairs++ >= 2) throw new AppError('AI_REPORT_FORMAT')
            reportOnly = true
            messages.push({ role: 'results', results: turn.calls.map(c => ({ id: c.id, error: true, value: { error: '同批包含报告和其他调用，整批未执行。只提交一个完整 save_report，不要新增查询。' } })) })
            continue
          }
          const content = dossierSchema.safeParse(turn.calls[0].input)
          if (!content.success) {
            if (round === 6 || repairs++ >= 2) throw new AppError('AI_REPORT_FORMAT')
            reportOnly = true
            messages.push({ role: 'results', results: [{ id: turn.calls[0].id, error: true, value: { error: '报告结构校验失败，请按 save_report 的完整 schema 修正。不得增加新查询。', fields: content.error.issues.map(i => i.path.filter(p => typeof p === 'number' || ['system','os','cpu','memory','uptime','value','confidence','evidenceIds','overview','disks','mount','size','used','applications','name','type','status','ports','directories','path','kind','unknowns'].includes(String(p))).join('.')).slice(0, 12) } }] })
            continue
          }
          const allowed = new Set(run.evidence.filter(e => e.state === 'succeeded').map(e => e.id))
          const validateRefs = (value: unknown): void => {
            if (!value || typeof value !== 'object') return
            const obj = value as Record<string, unknown>
            if (Array.isArray(obj.evidenceIds) && (obj.evidenceIds.some(id => !allowed.has(String(id))) || (obj.confidence !== 'unknown' && !obj.evidenceIds.length))) throw new AppError('AI_EVIDENCE_INVALID')
            for (const child of Object.values(obj)) if (Array.isArray(child)) child.forEach(validateRefs); else validateRefs(child)
          }
          try { validateRefs(content.data) }
          catch (e) {
            if (!(e instanceof AppError) || e.code !== 'AI_EVIDENCE_INVALID' || round === 6 || repairs++ >= 2) throw e
            reportOnly = true
            messages.push({ role: 'results', results: [{ id: turn.calls[0].id, error: true, value: { error: '证据引用无效。仅引用下面成功证据 UUID；非未知结论必须有证据。请修正报告，不要新增查询。', allowedEvidenceIds: [...allowed] } }] })
            continue
          }
          const json = JSON.stringify(content.data)
          if (this.servers.redactionValues(serverId).some(secret => secret && json.includes(secret))) throw new AppError('AI_INFERENCE_RESPONSE')
          check()
          if (!run.validationOnly) view.report = { snapshot, runId: run.id, serverRevision: run.serverRevision, collectedAt: run.sourceCollectedAt ?? Date.now(), model: run.model, content: content.data, evidence: run.evidence }
          run.operationId = null; update('completed', run.validationOnly ? '基础采集整理验证通过，原档案保留' : '服务器档案已保存'); return
        }
        const results: { id: string; value: unknown }[] = []
        for (const call of turn.calls) {
          if (reportOnly || call.name !== 'investigate') throw new AppError('AI_INFERENCE_RESPONSE')
          const parsed = querySchema.safeParse(call.input)
          if (!parsed.success) { results.push({ id: call.id, value: { error: '参数无效，请遵守工具结构。' } }); continue }
          try { results.push({ id: call.id, value: await collect(parsed.data) }) }
          catch (e) { if (e instanceof AppError && e.code === 'INVALID_INPUT') results.push({ id: call.id, value: { error: '目标不在已发现线索范围，已拒绝。请提交报告或使用已有目标。' } }); else throw e }
        }
        messages.push({ role: 'results', results })
      }
      throw new AppError('AI_BUDGET')
    } catch (e) {
      const code = controller.signal.aborted && controller.signal.reason instanceof AppError ? controller.signal.reason.code : e instanceof AppError ? e.code : 'INTERNAL'
      if (run.operationId) { try { if (this.servers.vaultState === 'unlocked') this.operations.cancel(run.operationId) } catch {} }
      if (this.servers.vaultState === 'unlocked') {
        view.report = previousReport
        if (e instanceof AiProtocolError) run.diagnostic = e.diagnostic
        run.state = code === 'CANCEL_REQUESTED' ? 'cancelled' : 'failed'; run.stage = '本次调查未完成，已有档案保留'; run.errorCode = code; run.updatedAt = Date.now(); run.operationId = null
        this.save(serverId, view)
      }
    } finally { clearTimeout(timer) }
  }
  close() { this.invalidated('CORE_UNAVAILABLE'); this.servers.invalidated.delete(this.invalidated); this.ai.changed.delete(this.aiChanged) }
}
