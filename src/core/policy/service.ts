import { permissiveRisks } from './permissive'
import { z } from 'zod'
import type { ApprovalPolicy, PolicyDecision } from '../../shared/contracts'
import { defaultRiskRules, riskPresets } from '../../shared/risk-presets'
import { AppError } from '../../shared/errors'
import { idSchema, parse } from '../validation'
import type { ServerService } from '../servers/service'
import { analyzeQuery, queryApprovalReason } from './queries'
import type { QueryScope } from './query-args'

const text = (max: number) => z.string().min(1).max(max).refine((s) => !s.includes('\0'))
const ruleSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(100), enabled: z.boolean(),
  action: z.enum(['allow', 'approval', 'deny']),
  profileIds: z.array(idSchema).max(100), serverIds: z.array(idSchema).max(100),
  command: text(16384).nullable(), cwd: text(4096).startsWith('/').nullable(),
  expiresAt: z.number().int().positive().nullable(),
}).strict().refine((r) => r.action !== 'allow' || r.command !== null)
const riskSettingSchema = z.object({ id: z.enum(['file-removal', 'disk-write', 'power-control', 'permissions']), enabled: z.boolean(), action: z.enum(['approval', 'deny']) }).strict()
const riskSettingsSchema = z.array(riskSettingSchema).length(4).refine((rules) => new Set(rules.map((r) => r.id)).size === 4)
const fileApprovalModesSchema = z.object({ 'all-approval': z.boolean().optional(), assisted: z.boolean().optional(), permissive: z.boolean().optional(), rules: z.boolean().optional(), paused: z.boolean().optional() }).strict()
const policySchema = z.object({ revision: z.number().int().nonnegative().safe(), mode: z.enum(['all-approval', 'assisted', 'permissive', 'rules', 'paused']), rules: z.array(ruleSchema).max(100), riskRules: riskSettingsSchema.optional(), aiAssist: z.boolean().optional(), uploadApprovalRequired: fileApprovalModesSchema.optional(), downloadApprovalRequired: fileApprovalModesSchema.optional() }).strict()
  .refine((p) => new Set(p.rules.map((r) => r.id)).size === p.rules.length)

// Conservative keyword hints only: never used to grant access or claim shell safety.
const riskPatterns = {
  'file-removal': /(?:^|[^a-zA-Z0-9_.-])(?:rm|unlink|shred)(?=$|[^a-zA-Z0-9_.-])/u,
  'disk-write': /(?:^|[^a-zA-Z0-9_.-])(?:mkfs(?:\.[a-zA-Z0-9_-]+)?|mke2fs|dd|wipefs|fdisk|sfdisk|parted)(?=$|[^a-zA-Z0-9_.-])/u,
  'power-control': /(?:^|[^a-zA-Z0-9_.-])(?:shutdown|reboot|poweroff|halt)(?=$|[^a-zA-Z0-9_.-])/u,
  'permissions': /(?:^|[^a-zA-Z0-9_.-])(?:chmod|chown|chgrp)(?=$|[^a-zA-Z0-9_.-])/u,
}
// Full strings are compared without trimming, shell parsing, globbing or classification.
export function evaluatePolicy(policy: ApprovalPolicy, input: { profileId: string; serverId: string; command: string; cwd: string; verifiedLogQuery?: boolean; queryScope?: QueryScope }, now = Date.now()): PolicyDecision {
  const base = { revision: policy.revision, mode: policy.mode, matchedRules: [] }
  if (policy.mode === 'paused') return { ...base, action: 'deny', reason: '已暂停新命令执行' }
  if (policy.mode === 'all-approval') return { ...base, action: 'approval', reason: '全部命令需要人工审批' }
  const matchedRules: PolicyDecision['matchedRules'] = policy.rules.filter((r) => r.enabled && (r.expiresAt === null || r.expiresAt > now)
    && (!r.profileIds.length || r.profileIds.includes(input.profileId))
    && (!r.serverIds.length || r.serverIds.includes(input.serverId))
    && (r.command === null || r.command === input.command) && (r.cwd === null || r.cwd === input.cwd))
    .map(({ id, name, action }) => ({ id, name, action }))
  const query = policy.mode === 'assisted' ? analyzeQuery(input.command, input.queryScope) : undefined
  if (policy.mode === 'permissive') {
    const risks = permissiveRisks(input.command, { denyPermissionChanges: policy.riskRules?.some(r => r.id === 'permissions' && r.enabled && r.action === 'deny') })
    for (const risk of risks) {
      const saved = (policy.riskRules ?? defaultRiskRules()).find(r => risk.id === `permissive:${r.id}`)
      // The permissive baseline remains active even if a legacy hint was disabled.
      if (saved?.enabled && saved.action === 'deny') risk.action = 'deny'
      matchedRules.push(risk)
    }
    const action = matchedRules.some(r => r.action === 'deny') ? 'deny' : matchedRules.some(r => r.action === 'approval') ? 'approval' : 'allow'
    return { ...base, action, matchedRules, reason: action === 'allow'
      ? matchedRules.length ? '宽松审批：匹配自定义放行规则，执行原始命令；不保证只读' : '宽松审批：未命中预设风险，按用户授权执行原始命令；不保证只读或无副作用'
      : `宽松审批：${matchedRules.filter(r => r.action !== 'allow').slice(0, 4).map(r => r.name).join('；')}，${action === 'deny' ? '拒绝执行' : '需要人工确认'}` }
  }
  for (const setting of policy.riskRules ?? defaultRiskRules()) {
    // A validated query cannot execute text in labels/patterns as a command.
    // Keep conservative risk hints for unknown syntax; never use them to allow it.
    if (!query?.plan && !input.verifiedLogQuery && setting.enabled && riskPatterns[setting.id].test(input.command)) {
      const preset = riskPresets.find((p) => p.id === setting.id)!
      matchedRules.push({ id: `builtin:${setting.id}`, name: preset.name, action: setting.action, risk: 'high' })
    }
  }
  const action = matchedRules.some((r) => r.action === 'deny') ? 'deny' : matchedRules.some((r) => r.action === 'approval') ? 'approval' : matchedRules.length ? 'allow' : 'approval'
  if (policy.mode === 'assisted' && !matchedRules.length) {
    if (input.verifiedLogQuery) return { ...base, action: 'allow', matchedRules: [{ id: 'builtin:application-log', name: '已维护日志入口的有界查询', action: 'allow' }], reason: '已校验应用版本、日志入口与固定查询命令，自动通过' }
    const { plan, analysis } = query!
    if (plan) return { ...base, action: 'allow', queryPlan: plan, queryAnalysis: analysis, matchedRules: [{ id: 'builtin:query', name: '可组合查询', action: 'allow' }], reason: `自动通过：已校验 ${plan.queries} 项查询或文本处理、${plan.labels} 项输出标签，执行重建后的命令` }
    return { ...base, action: 'approval', queryAnalysis: analysis, reason: queryApprovalReason(analysis) }
  }
  return { ...base, action, matchedRules, reason: matchedRules.length ? `${matchedRules.some((r) => r.risk === 'high') ? '检测到疑似高风险操作；' : ''}匹配规则，按${action === 'deny' ? '拒绝' : action === 'approval' ? '审批' : '放行'}处理（拒绝优先，其次审批）` : '没有匹配规则，默认人工审批' }
}

export class PolicyService {
  readonly changed = new Set<() => void>()
  constructor(private readonly servers: ServerService, private readonly aiConfigured: () => boolean = () => false) {}
  get(): ApprovalPolicy {
    this.servers.assertUnlocked()
    const row = this.servers.store.db.prepare('SELECT revision,detail FROM approval_policy WHERE id=1').get()
    if (!row) throw new AppError('STORAGE_FAILED')
    if (row.detail === null && row.revision === 0) return { revision: 0, mode: 'all-approval', rules: [] }
    const data = this.servers.reveal('approval-policy:v1', row.detail as Uint8Array)
    try {
      const policy = policySchema.parse(JSON.parse(data.toString()))
      if (policy.revision !== row.revision) throw new AppError('STORAGE_FAILED')
      return policy
    } catch { throw new AppError('STORAGE_FAILED') } finally { data.fill(0) }
  }
  save(raw: unknown): ApprovalPolicy {
    const { permissiveConfirmed, ...input } = parse(policySchema.extend({ permissiveConfirmed: z.boolean().optional() }), raw), current = this.get()
    if (input.mode === 'permissive' && current.mode !== 'permissive' && !permissiveConfirmed) throw new AppError('PERMISSIVE_CONFIRMATION')
    if (current.revision !== input.revision) throw new AppError('POLICY_CONFLICT')
    if (input.aiAssist && !current.aiAssist && !this.aiConfigured()) throw new AppError('AI_NOT_CONFIGURED')
    // Existing stale references may be kept/removed, but cannot be newly introduced.
    const previousProfiles = new Set(current.rules.flatMap((r) => r.profileIds))
    const previousServers = new Set(current.rules.flatMap((r) => r.serverIds))
    for (const rule of input.rules) {
      for (const id of rule.profileIds) if (!previousProfiles.has(id) && !this.servers.store.db.prepare('SELECT id FROM profiles WHERE id=?').get(id)) throw new AppError('INVALID_INPUT')
      for (const id of rule.serverIds) if (!previousServers.has(id) && !this.servers.store.getServer(id)) throw new AppError('INVALID_INPUT')
    }
    const next = { ...input, revision: input.revision + 1 }, data = Buffer.from(JSON.stringify(next))
    try {
      const encrypted = this.servers.protect('approval-policy:v1', data)
      const updated = this.servers.store.db.prepare('UPDATE approval_policy SET revision=?,detail=? WHERE id=1 AND revision=?').run(next.revision, encrypted, current.revision)
      if (updated.changes !== 1) throw new AppError('POLICY_CONFLICT')
    } catch (e) { if (e instanceof AppError) throw e; throw new AppError('STORAGE_FAILED') } finally { data.fill(0) }
    for (const listener of this.changed) listener()
    return next
  }
}
