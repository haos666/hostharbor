import { z } from 'zod'
const text = z.string().min(1).max(600)
const refs = z.array(z.string().uuid()).max(10)
const confidence = z.enum(['evidenced', 'inferred', 'unknown'])
const fact = z.object({ value: text, confidence, evidenceIds: refs }).strict()
export const dossierSchema = z.object({
  overview: text,
  system: z.object({ os: fact, cpu: fact, memory: fact, uptime: fact }).strict(),
  disks: z.array(z.object({ mount: text, size: text, used: text, confidence, evidenceIds: refs }).strict()).max(30),
  applications: z.array(z.object({ name: text, type: text, status: text, ports: z.array(text).max(20), confidence, evidenceIds: refs,
    directories: z.array(z.object({ path: text, kind: z.enum(['application', 'working', 'data', 'container', 'host-mount']), confidence, evidenceIds: refs }).strict()).max(15),
  }).strict()).max(40),
  unknowns: z.array(text).max(30),
}).strict()
export type DossierContent = z.infer<typeof dossierSchema>
export interface InvestigationEvidence {
  id: string; operationId: string; query: string; target: string; purpose: string
  state: string; exitCode?: number; errorCode: string | null; preview: string; truncated: boolean
}
export interface InvestigationRun {
  validationOnly?: boolean;
  diagnostic?: string;
  sourceCollectedAt?: number;
  id: string; serverRevision: number; startedAt: number; updatedAt: number
  provider: 'openai' | 'anthropic'; model: string; destination: string
  state: 'collecting' | 'awaiting_approval' | 'analyzing' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  stage: string; errorCode: string | null; operationId: string | null; evidence: InvestigationEvidence[]
}
export interface ServerDossier {
  manualFields?: string[];
  snapshot: string; stale?: boolean;
  runId: string; serverRevision: number; collectedAt: number; model: string
  content: DossierContent; evidence: InvestigationEvidence[]
}
export interface InvestigationView { corrections?: DossierCorrections; run: InvestigationRun | null; report: ServerDossier | null }
export const isInvestigating = (run: InvestigationRun | null) => !!run && ['collecting', 'awaiting_approval', 'analyzing'].includes(run.state)

// Manual values are separate from the last AI report. Arrays are corrected as a
// section because report rows do not have stable identities across AI refreshes.
export const correctionValuesSchema = z.object({
  overview: dossierSchema.shape.overview.optional(),
  system: z.object({ os: text.optional(), cpu: text.optional(), memory: text.optional(), uptime: text.optional() }).strict().optional(),
  disks: dossierSchema.shape.disks.optional(), applications: dossierSchema.shape.applications.optional(), unknowns: dossierSchema.shape.unknowns.optional(),
}).strict()
export const dossierCorrectionsSchema = z.object({ revision: z.number().int().positive(), updatedAt: z.number().int(), values: correctionValuesSchema }).strict()
export type DossierCorrections = z.infer<typeof dossierCorrectionsSchema>
export interface DossierEditInput { serverId: string; runId: string; revision: number; content: DossierContent }
export const systemFields = [{ key: 'os', label: '操作系统' }, { key: 'cpu', label: 'CPU' }, { key: 'memory', label: '内存' }, { key: 'uptime', label: '运行时间' }] as const
export function effectiveDossier(view: InvestigationView): InvestigationView {
  if (!view.report || !view.corrections) return view
  const content = structuredClone(view.report.content), values = view.corrections.values, fields: string[] = []
  if (values.overview !== undefined) { content.overview = values.overview; fields.push('overview') }
  for (const { key } of systemFields) if (values.system?.[key] !== undefined) { content.system[key] = { value: values.system[key]!, confidence: 'unknown', evidenceIds: [] }; fields.push(`system.${key}`) }
  for (const key of ['disks', 'applications', 'unknowns'] as const) if (values[key] !== undefined) { Object.assign(content, { [key]: structuredClone(values[key]) }); fields.push(key) }
  return { ...view, report: { ...view.report, content, manualFields: fields } }
}
