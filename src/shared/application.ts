import { z } from 'zod'
const label = z.string().trim().min(1).max(200)
const note = z.string().trim().max(1200)
const target = z.string().min(1).max(1024).refine(s => !/[\x00-\x1f\x7f]/.test(s))
export const logSourceSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().uuid(), name: label, kind: z.literal('file'), target: target.startsWith('/'), timezone: note }).strict(),
  z.object({ id: z.string().uuid(), name: label, kind: z.literal('journal'), target: z.string().regex(/^[A-Za-z0-9_@.:\x2d]+\.service$/).max(200), timezone: note }).strict(),
  z.object({ id: z.string().uuid(), name: label, kind: z.literal('docker'), target: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.\x2d]*$/).max(200), timezone: note }).strict(),
])
export const applicationInputSchema = z.object({
  serverId: z.string().uuid(), serverRevision: z.number().int().positive().optional(), id: z.string().uuid().optional(), revision: z.number().int().min(0),
  ports: z.array(label).max(20).optional(),
  name: label, aliases: z.array(label).max(20), description: note, environment: note,
  deploymentPath: z.string().max(1024).refine(s => s === '' || (s.startsWith('/') && !/[\x00-\x1f\x7f]/.test(s))),
  runtime: z.enum(['unknown', 'systemd', 'docker', 'process']), runtimeTarget: note,
  logSources: z.array(logSourceSchema).max(10),
  discovery: z.object({ runId: z.string().uuid(), index: z.number().int().min(0).max(39) }).strict().optional(),
}).strict()
export type LogSource = z.infer<typeof logSourceSchema>
export type ApplicationInput = z.infer<typeof applicationInputSchema>
export interface ApplicationRecord extends Omit<ApplicationInput, 'id' | 'discovery'> {
  schemaVersion: 1; serverRevision: number; connectionChanged?: boolean; id: string; createdAt: number; updatedAt: number; confirmedAt: number
  discovery?: { runId: string; collectedAt: number; evidenceIds: string[]; confidence: 'evidenced' | 'inferred' | 'unknown' }
}
export const logQuerySchema = z.object({
  serverId: z.string().uuid(), applicationId: z.string().uuid(), applicationRevision: z.number().int().positive(),
  sourceId: z.string().uuid(), requestKey: z.string().min(1).max(100),
  since: z.string().datetime({ offset: true }), until: z.string().datetime({ offset: true }),
  lines: z.number().int().min(1).max(500).default(200),
  contains: z.string().max(200).refine(s => !/[\x00-\x1f\x7f]/.test(s)).default(''),
}).strict().refine(q => Date.parse(q.until) > Date.parse(q.since) && Date.parse(q.until) - Date.parse(q.since) <= 86400000)
export type LogQuery = z.infer<typeof logQuerySchema>

export const applicationRecordSchema = applicationInputSchema.omit({ discovery: true }).extend({
  schemaVersion: z.literal(1), serverRevision: z.number().int().positive(), id: z.string().uuid(), revision: z.number().int().positive(),
  createdAt: z.number().int(), updatedAt: z.number().int(), confirmedAt: z.number().int(),
  discovery: z.object({ runId: z.string().uuid(), collectedAt: z.number().int(), evidenceIds: z.array(z.string().uuid()).max(10), confidence: z.enum(['evidenced', 'inferred', 'unknown']) }).strict().optional(),
}).strict()
