export interface BackupCounts { credentials: number; servers: number; dossiers: number; applications: number; fileSettings: number }
export type BackupItemStatus = 'new' | 'duplicate' | 'conflict' | 'blocked'
export interface BackupItem { id: string; kind: 'credential' | 'server'; name: string; detail?: string; status: BackupItemStatus; reason: 'new' | 'duplicate' | 'name' | 'host-key' | 'dependency'; dependencies: string[] }
export interface BackupPreview { sessionId: string; createdAt: number; expiresAt: number; counts: BackupCounts; items: BackupItem[] }
export interface BackupSelection { sessionId: string; servers: string[]; credentials: string[] }
export interface BackupImportResult { credentials: number; servers: number; skipped: number }
