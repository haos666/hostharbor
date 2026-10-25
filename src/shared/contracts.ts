export type Section = 'servers' | 'credentials' | 'connections' | 'operations' | 'audit' | 'settings'
import type { Result } from './errors'

export interface AppStatus {
  version: string
  core: 'starting' | 'ready' | 'unavailable'
  vault: 'not-configured' | 'locked' | 'unlocked'
  backgroundMcp?: boolean
  pendingApprovals?: number
  lockRevision: number
  security: 'not-configured' | 'legacy' | 'password'
  mcp: 'not-implemented' | 'stopped' | 'running'
}

export interface NotificationPreferences { revision: number; badge: boolean; system: boolean; sound: boolean }
export interface McpLockSettings { revision: number; pauseMcp: boolean }
export interface IdleLockSettings { revision: number; seconds: 30 | 1800 | null }
export type NotificationDelivery = 'none' | 'submitted' | 'shown' | 'failed' | 'unknown'
export interface NotificationSettingsState { preferences: NotificationPreferences; supported: boolean; delivery: NotificationDelivery }
export interface ApprovalSnapshot { vault: AppStatus['vault']; ids: string[] }
export interface ApprovalReminder { sequence: number; count: number; operationId?: string }
export interface ApprovalNavigation { operationId?: string; sequence: number }

export interface HostHarborApi {
  getLanguage(): Promise<Result<import('./i18n').LanguageSettings>>
  saveLanguage(preference: import('./i18n').LanguagePreference): Promise<Result<import('./i18n').LanguageSettings>>
  onLanguageChanged(listener: (settings: import('./i18n').LanguageSettings) => void): () => void
  browseFiles(input: { profileId: string; request: import('./files').FileBrowseInput }): Promise<Result<import('./files').FileBrowseResult>>
  fileWorkspace(serverId: string): Promise<Result<import('./files').FileWorkspace>>
  getFileAccess(input: { profileId: string; serverId: string }): Promise<Result<import('./files').FileAccess>>
  saveFileAccess(input: import('./files').FileAccessInput): Promise<Result<import('./files').FileAccess>>
  startFileTransfer(input: { profileId: string; request: import('./files').FileRequest }): Promise<Result<Operation>>

  getIdleLockSettings(): Promise<Result<IdleLockSettings>>
  saveIdleLockSettings(input: IdleLockSettings): Promise<Result<IdleLockSettings>>
  getNotificationSettings(): Promise<Result<NotificationSettingsState>>
  saveNotificationSettings(input: NotificationPreferences): Promise<Result<NotificationSettingsState>>
  testNotification(): Promise<Result<NotificationDelivery>>
  takeApprovalNavigation(): Promise<Result<ApprovalNavigation | null>>
  onApprovalNavigation(listener: () => void): () => void
  onApprovalReminder(listener: (reminder: ApprovalReminder | null) => void): () => void
  listApplications(serverId: string): Promise<Result<import('./application').ApplicationRecord[]>>
  saveApplication(input: import('./application').ApplicationInput): Promise<Result<import('./application').ApplicationRecord>>
  deleteApplication(input: { serverId: string; id: string; revision: number }): Promise<Result<void>>
  editServerDossier(input: import('./dossier').DossierEditInput): Promise<Result<import('./dossier').InvestigationView>>
  getServerDossier(serverId: string): Promise<Result<import('./dossier').InvestigationView>>
  startInvestigation(input: { serverId: string; serverRevision: number; aiRevision: number; reuseEvidence?: boolean; baselineOnly?: boolean }): Promise<Result<import('./dossier').InvestigationView>>
  cancelInvestigation(serverId: string): Promise<Result<import('./dossier').InvestigationView>>
  testAiTools(input: { revision: number }): Promise<Result<{ success: true }>>
  getAiSettings(): Promise<Result<AiSettings>>
  saveAiProvider(input: AiProviderInput): Promise<Result<AiSettings>>
  removeAiProvider(input: { revision: number; provider: AiProtocol }): Promise<Result<AiSettings>>
  listAiModels(input: AiConnectionInput): Promise<Result<AiModelList>>
  queryHistory(input: HistoryQuery): Promise<Result<HistoryPage>>
  getOperation(id: string): Promise<Result<Operation>>
  getRecordingStorage(): Promise<Result<RecordingStorage>>
  saveRecordingSettings(input: RecordingSettings): Promise<Result<RecordingStorage>>
  cleanRecordings(): Promise<Result<RecordingStorage>>
  clearOperationOutput(id: string): Promise<Result<void>>
  deleteOperation(id: string): Promise<Result<void>>
  reclaimRecordingSpace(): Promise<Result<RecordingStorage>>
  getApprovalPolicy(): Promise<Result<ApprovalPolicy>>
  saveApprovalPolicy(input: ApprovalPolicy & { permissiveConfirmed?: boolean }): Promise<Result<ApprovalPolicy>>
  previewApprovalPolicy(input: { profileId: string; serverId: string; command: string; cwd: string }): Promise<Result<PolicyDecision>>
  copyAccessToken(token: string): Promise<Result<void>>
  listProfiles(): Promise<Result<AccessProfile[]>>
  queryProfiles(input: ProfileQuery): Promise<Result<ProfilePage>>
  deleteProfile(input: { id: string; revision: number }): Promise<Result<void>>
  createProfile(input: ProfileInput): Promise<Result<{ profile: AccessProfile; token: string }>>
  updateProfile(input: ProfileUpdate): Promise<Result<AccessProfile>>
  prepareProfileToken(input: { id: string; revision: number; token?: string; regenerate?: true }): Promise<Result<void>>
  copyMcpInstallation(id: string): Promise<Result<void>>
  revokeProfile(id: string): Promise<Result<void>>
  mcpStatus(): Promise<Result<McpStatus>>
  startMcp(): Promise<Result<McpStatus>>
  stopMcp(): Promise<Result<void>>
  listOperations(): Promise<Result<Operation[]>>
  decideOperation(input: { id: string; approve: boolean }): Promise<Result<void>>
  cancelOperation(id: string): Promise<Result<Operation>>
  readOperationOutput(input: { id: string; cursor: number }): Promise<Result<OutputPage>>
  getStatus(): Promise<AppStatus>
  setupSecurity(input: { password: string; recovery: string }): Promise<Result<void>>
  onVaultLocked(callback: () => void): () => void
  getMcpLockSettings(): Promise<Result<McpLockSettings>>
  saveMcpLockSettings(input: McpLockSettings & { confirmed?: boolean }): Promise<Result<McpLockSettings>>
  unlockVault(password: string): Promise<Result<void>>
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<Result<void>>
  resetPassword(input: { recovery: string; newPassword: string }): Promise<Result<void>>
  changeRecovery(input: { currentPassword: string; currentRecovery: string; newRecovery: string }): Promise<Result<void>>
  lockVault(): Promise<Result<void>>
  listServers(): Promise<Result<ServerRecord[]>>
  saveServer(input: ServerInput): Promise<Result<ServerRecord>>
  deleteServer(id: string): Promise<Result<void>>
  listCredentials(): Promise<Result<CredentialSummary[]>>
  saveCredential(input: CredentialInput): Promise<Result<CredentialSummary>>
  deleteCredential(id: string): Promise<Result<void>>
  testConnection(id: string): Promise<Result<ConnectionTest>>
  trustHost(challengeId: string): Promise<Result<void>>
}

export type ServerRoute =
  | { type: 'direct' }
  | { type: 'ssh-jump'; serverId: string }
  | { type: 'socks5'; host: string; port: number; authentication: { type: 'none' } | { type: 'password'; username: string; credentialId: string } }

export type ServerElevation = { type: 'none' } | { type: 'sudo'; passwordSource: 'none' | 'login' | 'credential'; credentialId?: string }
export interface ServerInput {
  elevation?: ServerElevation
  route?: ServerRoute
  id?: string
  name: string
  host: string
  port: number
  username: string
  credentialId: string | null
}
export interface ServerRecord extends Omit<ServerInput, 'id' | 'route'> {
  route: ServerRoute
  id: string
  revision: number
  createdAt: number
}
export interface CredentialSummary {
  revision: number
  id: string
  name: string
  kind: 'password' | 'private-key'
  createdAt: number
}
export type CredentialInput = { id?: string; name: string } & (
  | { kind: 'password'; password: string }
  | { kind: 'private-key'; privateKey: string; passphrase?: string }
)
export type ConnectionTest =
  | { status: 'connected'; serverId: string; fingerprint: string; durationMs: number }
  | { status: 'host-key-required'; challengeId: string; host: string; port: number; fingerprint: string; keyType: string; expiresAt: number; role: 'jump' | 'target'; serverName: string }

export interface ClientGrant {
  id: string
  profileId: string
  serverIds: readonly string[]
  mode: 'confirm-each' | 'time-limited'
  expiresAt: number
  revokedAt?: number
}

export type AuthorizationDecision =
  | { outcome: 'deny'; reason: 'locked' | 'no-grant' | 'wrong-client' | 'revoked' | 'expired' | 'server-not-granted' }
  | { outcome: 'approval-required'; grantId: string }
  | { outcome: 'allow'; grantId: string }

export interface ProfileInput { name: string; serverIds: string[]; mode: 'policy' | 'confirm-each' | 'time-limited'; expiresAt: number | null }
export interface ProfileUpdate { id: string; revision: number; name: string; serverIds: string[]; expiresAt: number | null }
export type ProfileStatus = 'active' | 'expired' | 'revoked' | 'deleted'
export interface ProfileQuery { query?: string; status?: ProfileStatus | 'available' | 'all'; offset?: number; pageSize?: number }
export interface ProfilePage { profiles: AccessProfile[]; total: number; offset: number; pageSize: number }
export interface AccessProfile extends ProfileInput { id: string; createdAt: number; revokedAt?: number; revision: number; hasSavedToken: boolean; deletedAt?: number }
export interface McpStatus { running: boolean; url: string | null }
export interface CommandInput { elevation?: 'sudo'; serverId: string; requestKey: string; command: string; cwd: string; timeoutMs: number; connectTimeoutMs: number }
export type OperationState = 'awaiting_approval' | 'queued' | 'connecting' | 'dispatching' | 'running' | 'succeeded' | 'failed' | 'denied' | 'interrupted' | 'unknown' | 'expired'
export interface OperationGuidance {
  operationId: string; serverTime: number
  nextAction: 'poll' | 'ask_user' | 'read_output' | 'stop' | 'inspect'
  pollAfterMs: number | null
  approvalWaitUntil: number | null; approvalExpiresAt: number | null
  resume: { tool: 'get_operation'; arguments: { id: string } }
  automaticResubmitAllowed: false
  message: string
}
export interface Operation {
  transfer?: import('./files').TransferSpec
  fileResult?: import('./files').TransferResult
  agentGuidance?: OperationGuidance
  context?: { kind: 'application-log'; query: import('./application').LogQuery; source: import('./application').LogSource; applicationName: string; timeWindowApplied: boolean; selection: string }

  id: string; profileId: string; profileName: string; serverName: string; serverId: string
  replayClearedAt?: number | null; replayClearReason?: string | null; decidedAt?: number | null; humanDecision?: string | null
  profileRevision?: number
  decision?: PolicyDecision
  state: OperationState; input: CommandInput; snapshot: string
  routeServers: ServerRecord[];
  target: ServerRecord; dependencies: { id: string; name: string; revision: number }[]
  createdAt: number; updatedAt: number; intentAt: number | null; outputBytes: number
  errorCode: string | null; confirmedCwd?: string; exitCode?: number; signal?: string
}
export interface OutputChunk { seq: number; stream: 'stdout' | 'stderr'; elapsedMs: number; text: string }
export interface OutputPage { chunks: OutputChunk[]; nextCursor: number; state: OperationState; replayClearedAt?: number | null; agentGuidance?: OperationGuidance }

export type PolicyAction = 'allow' | 'approval' | 'deny'
export type ApprovalMode = 'all-approval' | 'assisted' | 'permissive' | 'rules' | 'paused'
export interface ApprovalRule {
  id: string; name: string; enabled: boolean; action: PolicyAction
  profileIds: string[]; serverIds: string[]
  command: string | null; cwd: string | null; expiresAt: number | null
}
export interface RiskRuleSetting { id: import('./risk-presets').RiskPresetId; enabled: boolean; action: 'approval' | 'deny' }
export interface ApprovalPolicy { revision: number; mode: ApprovalMode; rules: ApprovalRule[]; riskRules?: RiskRuleSetting[]; aiAssist?: boolean; uploadApprovalRequired?: Partial<Record<ApprovalMode, boolean>>; downloadApprovalRequired?: Partial<Record<ApprovalMode, boolean>> }
export interface ApprovalAiReview {
  status: 'pending' | 'complete' | 'unavailable' | 'sensitive'
  recommendation?: 'approval' | 'query'
  risks?: string[]
  reason: string
  provider?: AiProtocol; model?: string; reviewedAt?: number
}
export interface PolicyDecision {
  revision: number; mode: ApprovalMode; action: PolicyAction
  reason: string; matchedRules: { id: string; name: string; action: PolicyAction; risk?: 'high' }[]
  queryPlan?: { version: 1 | 2; command: string; queries?: number; labels?: number; scopeRevision?: string }
  queryAnalysis?: QueryAnalysis
  aiReview?: ApprovalAiReview
}
export interface QueryAnalysis {
  version: 2
  checks: { index: number; status: 'supported' | 'approval'; kind?: string; reason: string }[]
  issue?: string
}

export interface HistoryQuery { kind?: 'file-transfer'; transferDirection?: 'upload' | 'download'; pageSize?: 20 | 50 | 100; stateGroup?: 'active' | 'terminal'; includeOptions?: boolean; serverId?: string; profileId?: string; state?: OperationState; since?: number; until?: number; search?: string; offset?: number }
export interface HistoryPage { operations: Operation[]; total: number; offset: number; pageSize?: number; options?: { servers: { id: string; name: string }[]; profiles: { id: string; name: string }[] } }
export interface RecordingSettings { revision: number; retentionDays: number; quotaMiB: number }
export interface RecordingStorage {
  settings: RecordingSettings; databaseBytes: number; reusableBytes: number; outputStoredBytes: number
  outputCount: number; operationCount: number; lastMaintenanceFailed: boolean
}

export type AiProtocol = 'openai' | 'anthropic'
export interface AiProviderSummary { baseUrl: string; model: string; hasKey: boolean }
export interface AiSettings { revision: number; activeProvider: AiProtocol | null; providers: { openai: AiProviderSummary | null; anthropic: AiProviderSummary | null } }
export interface AiConnectionInput { revision: number; provider: AiProtocol; baseUrl: string; apiKey?: string }
export interface AiProviderInput extends AiConnectionInput { model: string }
export interface AiModelList { models: { id: string; name: string }[]; truncated: boolean }
