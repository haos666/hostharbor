import { z } from 'zod'
import { AppError } from '../shared/errors'

const id = z.string().uuid()
export const idSchema = id
const label = z.string().trim().min(1).max(100)
const host = z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9._:%-]+$/)
const port = z.number().int().min(1).max(65535)
export const routeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direct') }).strict(),
  z.object({ type: z.literal('ssh-jump'), serverId: id }).strict(),
  z.object({ type: z.literal('socks5'), proxyId: id.optional(), host, port, authentication: z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }).strict(),
    z.object({ type: z.literal('password'), username: z.string().min(1).refine((value) => Buffer.byteLength(value) <= 255), credentialId: id }).strict(),
  ]) }).strict(),
])
export const elevationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('sudo'), passwordSource: z.enum(['none', 'login', 'credential']), credentialId: id.optional() }).strict().refine(e => e.passwordSource === 'credential' ? !!e.credentialId : !e.credentialId),
])
export const serverSchema = z.object({
  id: id.optional(), name: label,
  host: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9._:%-]+$/),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(128).regex(/^[^\s\x00-\x1f\x7f]+$/),
  credentialId: id.nullable(),
  elevation: elevationSchema.default({ type: 'none' }),
  route: routeSchema.default({ type: 'direct' }),
}).strict()
export const credentialSchema = z.discriminatedUnion('kind', [
  z.object({ id: id.optional(), name: label, kind: z.literal('password'), password: z.string().min(1).max(65536) }).strict(),
  z.object({ id: id.optional(), name: label, kind: z.literal('private-key'), privateKey: z.string().min(1).max(262144), passphrase: z.string().max(65536).optional() }).strict(),
])
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new AppError('INVALID_INPUT')
  return result.data
}

export const proxySchema = z.object({ id: id.optional(), revision: z.number().int().positive().optional(), name: label, route: routeSchema.options[2].omit({proxyId: true}) }).strict()
export const proxyCatalogSchema = z.array(proxySchema.extend({id, revision:z.number().int().positive()})).max(200)
