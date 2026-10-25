import { z } from 'zod'
const id = z.string().uuid()
export const remotePathSchema = z.string().min(1).max(2048).startsWith('/').refine(p => !/[\x00-\x1f\x7f\\]/.test(p) && !p.split('/').includes('..'))
export const localNameSchema = z.string().min(1).max(200).refine(s => !/[\x00-\x1f\x7f\\/:*?"<>|]/.test(s) && s !== '.' && s !== '..' && !/[. ]$/.test(s) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s))
export const localPathSchema = z.string().min(1).max(4096).refine(p => /^(?:\/|[A-Za-z]:[\\/])/.test(p) && !/[\x00-\x1f\x7f]/.test(p) && !p.split(/[\\/]/).includes('..') && !p.startsWith('//'))
export const fileSettingsSchema = z.object({ serverId: id, revision: z.number().int().nonnegative(), uploadEnabled: z.boolean(), uploadDirectory: z.union([remotePathSchema, z.literal('')]), maxFileSizeMiB: z.number().int().min(1).max(10240), verification: z.enum(['standard', 'full']).default('standard'), idleTimeoutSeconds: z.number().int().min(30).max(3600).default(120), totalTimeoutMinutes: z.number().int().min(1).max(1440).default(120) }).strict().refine(a => !a.uploadEnabled || !!a.uploadDirectory)
export const fileRequestSchema = z.object({ serverId: id, requestKey: z.string().min(1).max(100), direction: z.enum(['list', 'upload', 'download']), remotePath: remotePathSchema.optional(), remoteName: localNameSchema.optional(), localPath: localPathSchema.optional(), expectedSize: z.number().int().nonnegative().safe().optional(), expectedMtime: z.number().int().nonnegative().safe().optional(), offset: z.number().int().min(0).max(10000).default(0) }).strict().superRefine((r, ctx) => {
  if (r.direction === 'upload' ? !r.remoteName || !!r.remotePath : !r.remotePath || !!r.remoteName) ctx.addIssue({ code: 'custom', message: 'Use remoteName for upload, remotePath otherwise' })
  if (r.direction !== 'list' && !r.localPath || r.direction === 'list' && !!r.localPath) ctx.addIssue({ code: 'custom', message: 'Transfer requires a local absolute path' })
})
export type FileRequest = z.input<typeof fileRequestSchema>
export type FileAccess = z.infer<typeof fileSettingsSchema>
export type FileAccessInput = FileAccess & { profileId: string }
export interface TransferSpec {
  version: 2
  request: z.output<typeof fileRequestSchema> & { remotePath: string }
  accessRevision: number; maxBytes: number
  verification?: 'standard' | 'full'; idleTimeoutMs?: number; totalTimeoutMs?: number
  sourceHash?: string; sourceSize?: number
  sourceIdentity?: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }
}
export interface RemoteFile { name: string; kind: 'file' | 'directory' | 'symlink' | 'other'; size: number; mtime: number }
export type TransferStage = 'preparing' | 'opening' | 'transferring' | 'verifying' | 'publishing' | 'completed'
export interface TransferResult { startedAt?: number; stageStartedAt?: number; stageDurationsMs?: Partial<Record<TransferStage, number>>; preparedBytes?: number; verifiedBytes?: number; verification?: 'standard' | 'full'; verificationComplete?: boolean; stage?: TransferStage; publicationAttempted?: boolean; failure?: { code: string; sftpStatus?: number }; bytes: number; total?: number; sha256?: string; tempPath?: string; published?: boolean; entries?: RemoteFile[]; nextOffset?: number | null }
export const fileBrowseSchema = z.object({ serverId: id, remotePath: remotePathSchema, offset: z.number().int().min(0).max(10000).default(0) }).strict()
export type FileBrowseInput = z.input<typeof fileBrowseSchema>
export interface FileBrowseResult { remotePath: string; entries: RemoteFile[]; nextOffset: number | null }
export interface FileWorkspace { desktopProfileId: string }
