import { z } from 'zod'
import { inspectionChecks, inspectionDocumentSchema } from '../../shared/inspection'
import { utils } from 'ssh2'
import { createHash } from 'node:crypto'
import { credentialSchema, serverSchema } from '../validation'
import { dossierSchema, dossierCorrectionsSchema } from '../../shared/dossier'
import { applicationRecordSchema } from '../../shared/application'
import { fileSettingsSchema } from '../../shared/files'
import { AppError } from '../../shared/errors'

const id = z.string().uuid()
const dossier = z.object({ runId: id, collectedAt: z.number().int().nonnegative(), model: z.string().max(600), content: dossierSchema, corrections: dossierCorrectionsSchema.optional() }).strict()
export const portableSchema = z.object({
  version: z.literal(1), createdAt: z.number().int().nonnegative(),
  credentials: z.array(credentialSchema.and(z.object({ id }))).max(2000),
  servers: z.array(serverSchema.extend({ id, sourceRevision: z.number().int().positive(), inspection: inspectionDocumentSchema.optional(), dossier: dossier.optional(), applications: z.array(applicationRecordSchema).max(40), files: fileSettingsSchema.optional() })).max(1000),
  hosts: z.array(z.object({ host: serverSchema.shape.host, port: serverSchema.shape.port, key: z.string().min(1).max(32768), fingerprint: z.string().max(100), confirmedAt: z.number().int().nonnegative() }).strict()).max(2000),
}).strict()
export type PortableBackup = z.infer<typeof portableSchema>
export function validatePortable(raw: unknown): PortableBackup {
  const parsed = portableSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('BACKUP_INVALID')
  const p = parsed.data, credentials = new Map(p.credentials.map(c => [c.id, c])), servers = new Map(p.servers.map(s => [s.id, s]))
  const unique = (values: string[]) => new Set(values).size === values.length
  if (!unique([...credentials.keys(), ...servers.keys()]) || credentials.size !== p.credentials.length || servers.size !== p.servers.length || !unique(p.hosts.map(h => JSON.stringify([h.host, h.port])))) throw new AppError('BACKUP_INVALID')
  const password = (i: string | null | undefined) => !!i && credentials.get(i)?.kind === 'password'
  const apps: string[] = []
  for (const c of p.credentials) if (c.kind === 'private-key') {
    const key = utils.parseKey(c.privateKey, c.passphrase)
    if (key instanceof Error || Array.isArray(key) || !key.isPrivateKey()) throw new AppError('BACKUP_INVALID')
  }
  for (const s of p.servers) {
    if (s.credentialId && !credentials.has(s.credentialId)) throw new AppError('BACKUP_INVALID')
    if (s.route.type === 'ssh-jump') {
      const jump = servers.get(s.route.serverId)
      if (!jump || jump.id === s.id || jump.route.type !== 'direct' || !jump.credentialId) throw new AppError('BACKUP_INVALID')
    }
    if (s.route.type === 'socks5' && s.route.authentication.type === 'password' && !password(s.route.authentication.credentialId)) throw new AppError('BACKUP_INVALID')
    if (s.elevation.type === 'sudo' && s.elevation.passwordSource !== 'none' && !password(s.elevation.passwordSource === 'login' ? s.credentialId : s.elevation.credentialId)) throw new AppError('BACKUP_INVALID')
    if (s.inspection && (!inspectionChecks(s.inspection.markdown).length || inspectionChecks(s.inspection.markdown).length > 40 || s.inspection.applicationIds.some(id => !s.applications.some(a => a.id === id)))) throw new AppError('BACKUP_INVALID')
    if (s.files && s.files.serverId !== s.id) throw new AppError('BACKUP_INVALID')
    for (const a of s.applications) { if (a.serverId !== s.id || !unique(a.logSources.map(l => l.id))) throw new AppError('BACKUP_INVALID'); apps.push(a.id) }
  }
  if (!unique([...credentials.keys(), ...servers.keys(), ...apps])) throw new AppError('BACKUP_INVALID')
  for (const h of p.hosts) {
    const key = Buffer.from(h.key, 'base64')
    if (!key.length || key.toString('base64') !== h.key || h.fingerprint !== `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}` || !p.servers.some(s => s.host === h.host && s.port === h.port)) throw new AppError('BACKUP_INVALID')
    const parsedKey = utils.parseKey(key)
    if (parsedKey instanceof Error || Array.isArray(parsedKey)) throw new AppError('BACKUP_INVALID')
  }
  return p
}
