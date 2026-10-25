import { msg, errorText } from '../../../shared/i18n'
import { QueryChecks } from './QueryChecks'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Plus, ShieldCheck, X } from 'lucide-react'
import type { AccessProfile, AiSettings, AppStatus, ApprovalMode, ApprovalPolicy, ApprovalRule, PolicyDecision, ServerRecord } from '../../../shared/contracts'
import { defaultRiskRules } from '../../../shared/risk-presets'
import { riskPresets } from '../catalog'
import type { Result } from '../../../shared/errors'
import { Dialog } from './Dialog'
import { UnlockGate } from './SecuritySettings'
const api = window.hostharbor
const actions = { get allow() { return msg('approvalSettings.automaticallyAllow') }, get approval() { return msg('agentWorkspace.manualApproval') }, get deny() { return msg('approvalSettings.denyExecution') } }
const modes: { id: ApprovalMode; name: string; detail: string }[] = [
  { id: 'all-approval', get name() { return msg('approvalSettings.approveAll') }, get detail() { return msg('approvalSettings.confirmEveryCommand') } },
  { id: 'assisted', get name() { return msg('approvalSettings.assistedApproval') }, get detail() { return msg('approvalSettings.verifiedQueriesRunOthersNeedApproval') } },
  { id: 'permissive', get name() { return msg('approvalSettings.permissiveApproval') }, get detail() { return msg('approvalSettings.dailyOperationsRunDestructiveActionsNeedApproval') } },
  { id: 'paused', get name() { return msg('approvalSettings.pauseExecution') }, get detail() { return msg('approvalSettings.denyAllNewCommands') } },
]
function unwrap<T>(r: Result<T>): T { if (!r.ok) throw new Error(errorText(r.error)); return r.value }
export function ApprovalSettings({ status, servers, onRefresh, onSetup }: { status: AppStatus | null; servers: ServerRecord[]; onRefresh: () => Promise<void>; onSetup: () => void }) {
  const [policy, setPolicy] = useState<ApprovalPolicy | null>(null), [profiles, setProfiles] = useState<AccessProfile[]>([])
  const [editing, setEditing] = useState<ApprovalRule | null>(null), [deleting, setDeleting] = useState<ApprovalRule | null>(null)
  const [mode, setMode] = useState<ApprovalMode | null>(null), [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [ai, setAi] = useState<AiSettings | null>(null), [aiConfirm, setAiConfirm] = useState(false)
  const epoch = useRef(0), unlocked = status?.vault === 'unlocked'
  useEffect(() => {
    const current = ++epoch.current
    setPolicy(null); setProfiles([]); setEditing(null); setDeleting(null); setMode(null); setPreviewing(false); setError('')
    setAi(null); setAiConfirm(false)
    if (unlocked) void Promise.all([api.getApprovalPolicy(), api.listProfiles(), api.getAiSettings()]).then(([p, a, config]) => {
      if (current === epoch.current) { setPolicy(unwrap(p)); setProfiles(unwrap(a)); setAi(unwrap(config)) }
    }).catch((e: Error) => { if (current === epoch.current) setError(e.message) })
    return () => { epoch.current++ }
  }, [unlocked, status?.lockRevision])
  async function save(next: ApprovalPolicy, permissiveConfirmed = false) {
    if (busy) return
    const current = epoch.current
    setBusy(true); setError('')
    try {
      const saved = unwrap(await api.saveApprovalPolicy({ ...next, permissiveConfirmed }))
      if (current !== epoch.current) return
      setPolicy(saved); setEditing(null); setDeleting(null); setMode(null); setAiConfirm(false); await onRefresh()
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : msg('approvalSettings.saveFailed')) }
    finally { setBusy(false) }
  }
  async function reload() {
    const current = epoch.current
    try { const next = unwrap(await api.getApprovalPolicy()); if (current === epoch.current) { setPolicy(next); setError('') } }
    catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : msg('aiSettings.loadFailed')) }
  }
  const open = (job: () => void) => { setError(''); job() }
  const errorView = error && <p className="drawer-error" role="alert">{error}</p>
  const aiProvider = ai?.activeProvider, aiEntry = aiProvider ? ai?.providers[aiProvider] : null
  return <section className="approval-settings">
    <header className="credentials-header"><div className="credentials-title"><span className="page-label">{msg('aiSettings.settings')}</span><h1>{msg('approvalSettings.approvalPolicy')}</h1></div></header>
    {!unlocked ? <UnlockGate status={status} onRefresh={onRefresh} onSetup={onSetup} /> : !policy ? <>{errorView}<button className="credential-secondary" onClick={() => void reload()}>{msg('aiSettings.reload')}</button></> : <>
      {!editing && !deleting && !mode && !aiConfirm && error && <>{errorView}<button className="credential-secondary" disabled={busy} onClick={() => void reload()}>{msg('approvalSettings.reloadPolicy')}</button></>}
      <div className="policy-modes" role="group" aria-label={msg('approvalSettings.approvalMode')}>{modes.map((item) => <div key={item.id} className={`policy-mode-card${policy.mode === item.id ? ' selected' : ''}`}><button aria-pressed={policy.mode === item.id} disabled={busy} onClick={() => { if (item.id !== policy.mode) open(() => setMode(item.id)) }}><ShieldCheck size={19} /><strong>{item.name}</strong><span>{item.detail}</span></button></div>)}</div>
      <section className="policy-file-approvals" aria-labelledby="file-approvals-title"><header><h2 id="file-approvals-title">{msg('approvalSettings.fileApprovals')}</h2><span>{msg('approvalSettings.currentFileMode', {mode: modes.find(item => item.id === policy.mode)?.name ?? msg('approvalSettings.legacyRuleMode')})}</span></header>
        <div className="policy-file-options"><label><input type="checkbox" checked={policy.uploadApprovalRequired?.[policy.mode] ?? true} disabled={busy} onChange={e => void save({ ...policy, uploadApprovalRequired: { ...policy.uploadApprovalRequired, [policy.mode]: e.target.checked } })} /><span>{msg('approvalSettings.uploadsRequireApproval')}</span></label><label><input type="checkbox" checked={policy.downloadApprovalRequired?.[policy.mode] ?? true} disabled={busy} onChange={e => void save({ ...policy, downloadApprovalRequired: { ...policy.downloadApprovalRequired, [policy.mode]: e.target.checked } })} /><span>{msg('approvalSettings.downloadsRequireApproval')}</span></label></div>
        <p>{msg('approvalSettings.fileApprovalHelp')}</p>
      </section>
      {policy.mode === 'rules' && <div className="operation-warning" role="status">{msg('approvalSettings.legacyRulesAreRetainedUnmatchedCommandsStillNeed')}</div>}
      {policy.mode === 'permissive' && <section className="assisted-policy"><h2>{msg('approvalSettings.permissiveExecutionScope')}</h2><p>{msg('approvalSettings.dailyOperationsRunAutomaticallyIncludingConfigurationEditsInstalls')}</p><p>{msg('approvalSettings.originalCommandsExecuteAndMayReadSensitiveFiles')}</p><details><summary>{msg('approvalSettings.actionsRequiringConfirmation')}</summary><p>{msg('approvalSettings.deletingOrTruncatingFilesDeletingContainersImagesOr')}</p><p>{msg('approvalSettings.writesRedirectionVariablesLoopsBackgroundJobsAndScripts')}</p><p>{msg('approvalSettings.baselineRiskDetectionAlwaysAppliesLegacyDisabledHints')}</p></details></section>}
      <p className="agent-hint">{msg('approvalSettings.thePolicyAppliesToEveryAccessProfileIncluding')}</p>
      {policy.mode === 'assisted' && <section className="assisted-policy">
        <h2>{msg('approvalSettings.commonDiagnosticQueries')}</h2><p>{msg('approvalSettings.systemStateVersionsFileMetadataLogsAndBounded')}</p>
        <details><summary>{msg('approvalSettings.viewSupportedScope')}</summary><p>{msg('approvalSettings.supportsSemicolonsNewlinesPipesAndLiteralEchoPrintf')}</p><p>{msg('approvalSettings.coversResourcesPortsProcessesDisksNetworkMetadataRegistered')}</p><p>{msg('approvalSettings.curlIsRestrictedToHeadAndFixedHealth')}</p><p>{msg('approvalSettings.writesStartStopActionsDynamicExpansionGeneralScripts')}</p></details>
        <div className="assisted-ai-toggle"><div><strong>{msg('approvalSettings.aiRiskAdvice')}</strong><p>{msg('approvalSettings.providesAdviceForUnmatchedRulesAiCannotIndependently')}</p></div><label className="notification-setting"><input type="checkbox" role="switch" aria-label={msg('approvalSettings.enableAiRiskAdvice')} disabled={busy || (!aiEntry && !policy.aiAssist)} checked={!!policy.aiAssist} onChange={e => e.target.checked ? setAiConfirm(true) : void save({ ...policy, aiAssist: false })} />{policy.aiAssist ? msg('approvalSettings.on') : msg('approvalSettings.off')}</label></div>
        <small>{aiEntry ? `${aiProvider} · ${aiEntry.model} · ${aiEntry.baseUrl}` : msg('approvalSettings.saveTheAddressKeyAndModelInAi')}</small>
        <p className="agent-hint">{msg('approvalSettings.onlyTheCommandAndDirectoryAreSentTo')}</p>
      </section>}
      {(policy.mode === 'rules' || policy.mode === 'assisted' || policy.mode === 'permissive') && <>
      {policy.mode !== 'permissive' && <><div className="policy-toolbar"><div><h2>{msg('approvalSettings.builtInRiskRules')} <small>{riskPresets.length} {msg('approvalSettings.items')}</small></h2><p>{msg('approvalSettings.highRiskActionsRequireManualApprovalByDefault')}</p></div><button className="credential-secondary" onClick={() => open(() => setPreviewing(true))}>{msg('approvalSettings.matchPreview')}</button></div>
      <div className="risk-preset-list">{riskPresets.map((preset) => {
        const setting = (policy.riskRules ?? defaultRiskRules()).find((r) => r.id === preset.id)!
        const update = (patch: Partial<typeof setting>) => void save({ ...policy, riskRules: (policy.riskRules ?? defaultRiskRules()).map((r) => r.id === preset.id ? { ...r, ...patch } : r) })
        return <article key={preset.id} className={`risk-preset ${setting.enabled ? '' : 'is-disabled'}`}><div><div className="risk-preset-title"><strong>{preset.name}</strong><span className="risk-level">{msg('approvalSettings.highRisk')}</span></div><code>{preset.commands}</code><p>{preset.description}</p></div><div className="risk-preset-controls"><select aria-label={msg('approvalSettings.valueAction', { value0: preset.name })} disabled={busy || !setting.enabled} value={setting.action} onChange={(e) => update({ action: e.target.value as 'approval' | 'deny' })}><option value="approval">{msg('agentWorkspace.manualApproval')}</option><option value="deny">{msg('approvalSettings.denyExecution')}</option></select><label><input type="checkbox" aria-label={msg('approvalSettings.enableValueRule', { value0: preset.name })} disabled={busy} checked={setting.enabled} onChange={(e) => update({ enabled: e.target.checked })} />{setting.enabled ? msg('approvalSettings.enabled') : msg('approvalSettings.disabled')}</label></div></article>
      })}</div>
      <p className="agent-hint">{msg('approvalSettings.keywordDetectionMayProduceFalsePositivesOrMiss')}{policy.mode === 'assisted' ? msg('approvalSettings.commandsOutsideBuiltInQueriesOrCustomAllow') : msg('approvalSettings.unrecognizedCommandsNeedApprovalByDefaultAutomaticExecution')}</p>
      </>}
      <details className="policy-advanced"><summary>{msg('approval.customRuleCount', { count: policy.rules.length })}</summary>
      <div className="policy-toolbar"><div><h2>{msg('approvalSettings.customRules')} <small>{policy.rules.length} / 100</small></h2><p>{msg('approvalSettings.denialTakesPriorityOverApprovalWhichTakesPriority')}</p></div><div><button className="credential-secondary" disabled={busy} onClick={() => open(() => setPreviewing(true))}>{msg('approvalSettings.matchPreview')}</button><button className="credential-primary" disabled={busy || policy.rules.length >= 100} onClick={() => open(() => setEditing({ id: crypto.randomUUID(), name: '', action: 'approval', enabled: true, profileIds: [], serverIds: [], command: null, cwd: null, expiresAt: null }))}><Plus size={15} />{msg('approvalSettings.addRule')}</button></div></div>
      {!policy.rules.length ? <div className="agent-empty"><ShieldCheck size={28} /><h2>{msg('approvalSettings.noCustomRulesYet')}</h2><p>{msg('approvalSettings.forExampleAllowAnExactCommandForA')}</p></div> : <div className="agent-list">{policy.rules.map((r) => <article className="agent-row policy-rule" key={r.id}><div><strong>{r.name}</strong><span className={`policy-action action-${r.action}`}>{actions[r.action]}</span><p>{r.enabled ? r.expiresAt !== null && r.expiresAt <= Date.now() ? msg('approvalSettings.expired') : msg('approvalSettings.enabled') : msg('approvalSettings.disabled')} · {r.profileIds.length ? msg('approvalSettings.valueAccessProfiles', { value0: r.profileIds.length }) : msg('approvalSettings.allAccessProfiles')} · {r.serverIds.length ? msg('approvalSettings.valueServers', { value0: r.serverIds.length }) : msg('approvalSettings.allServers')}</p><code>{r.command === null ? msg('approvalSettings.allCommands') : r.command}</code>{r.cwd && <small>{msg('approvalSettings.requestedDirectory')}{r.cwd}</small>}</div><div className="policy-row-actions"><button className="credential-secondary" disabled={busy} onClick={() => open(() => setEditing(r))}>{msg('approvalSettings.edit')}</button><button className="text-button" disabled={busy} onClick={() => open(() => setDeleting(r))}>{msg('agentWorkspace.delete')}</button></div></article>)}</div>}
      <p className="security-footnote">{msg('approvalSettings.policyChangesInvalidatePendingAndUndispatchedRequestsDispatched')}</p>
      </details>
      </>}
      {mode && <Dialog className="agent-dialog" labelledBy="policy-mode-title" onDismiss={() => { if (!busy) setMode(null) }}><h2 id="policy-mode-title">{msg('common.switchMode', { mode: modes.find((m) => m.id === mode)?.name })}</h2><p>{mode === 'assisted' ? msg('approvalSettings.builtInSystemQueriesAndBoundedQueriesUsing') : mode === 'permissive' ? msg('approvalSettings.onlyRecognizedDestructiveActionsRequireConfirmationRoutineEdits') : mode === 'paused' ? msg('approvalSettings.denyNewCommandsDispatchedCommandsContinue') : msg('approvalSettings.everyNewCommandNeedsManualConfirmationAllowRules')}</p><p>{msg('approvalSettings.pendingAndUndispatchedRequestsBecomeInvalid')}</p>{errorView}<div className="agent-dialog-actions"><button className="credential-secondary" disabled={busy} onClick={() => setMode(null)}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy} onClick={() => void save({ ...policy, mode }, mode === 'permissive')}>{busy ? msg('agentWorkspace.saving') : msg('approvalSettings.confirmSwitch')}</button></div></Dialog>}
      {aiConfirm && <Dialog className="agent-dialog" labelledBy="ai-approval-confirm" onDismiss={() => { if (!busy) setAiConfirm(false) }}><h2 id="ai-approval-confirm">{msg('approvalSettings.enableAiRiskAdvice2')}</h2><p>{msg('approvalSettings.unmatchedCommandsAndRequestedDirectoriesAreSentTo')}</p><p>{aiProvider} · {aiEntry?.model}</p><code>{aiEntry?.baseUrl}</code><p>{msg('approvalSettings.suspectedSensitiveCommandsAreSkippedButFilteringCannot')}</p>{errorView}<div className="agent-dialog-actions"><button className="credential-secondary" disabled={busy} onClick={() => setAiConfirm(false)}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy || !aiEntry} onClick={() => void save({ ...policy, aiAssist: true })}>{msg('approvalSettings.enable')}</button></div></Dialog>}
      {editing && <RuleEditor key={editing.id} rule={editing} profiles={profiles} servers={servers} busy={busy} error={error} onClose={() => setEditing(null)} onSave={(r) => void save({ ...policy, rules: policy.rules.some((old) => old.id === r.id) ? policy.rules.map((old) => old.id === r.id ? r : old) : [...policy.rules, r] })} />}
      {deleting && <Dialog className="agent-dialog" labelledBy="delete-rule-title" onDismiss={() => { if (!busy) setDeleting(null) }}><h2 id="delete-rule-title">{msg('common.deleteNamed', { name: deleting.name })}</h2><p>{msg('approvalSettings.afterSavingUndispatchedRequestsBecomeInvalid')}</p>{errorView}<div className="agent-dialog-actions"><button className="credential-secondary" disabled={busy} onClick={() => setDeleting(null)}>{msg('agentWorkspace.cancel')}</button><button className="destructive-button" disabled={busy} onClick={() => void save({ ...policy, rules: policy.rules.filter((r) => r.id !== deleting.id) })}>{msg('approvalSettings.deleteRule')}</button></div></Dialog>}
      {previewing && <PolicyPreview profiles={profiles} servers={servers} onClose={() => setPreviewing(false)} />}
    </>}
  </section>
}
function ScopePicker({ label, ids, items, onChange }: { label: string; ids: string[]; items: { id: string; name: string }[]; onChange: (ids: string[]) => void }) {
  const missing = ids.filter((id) => !items.some((item) => item.id === id))
  return <fieldset className="policy-scope"><legend>{label}</legend><label className="agent-check"><input type="checkbox" checked={!ids.length} onChange={(e) => { if (e.target.checked) onChange([]); else if (items[0]) onChange([items[0].id]) }} />{msg('approvalSettings.all')}{label}</label>{[...items, ...missing.map((id) => ({ id, name: msg('approvalSettings.deletedRecord') }))].map((item) => <label className="agent-check" key={item.id}><input type="checkbox" checked={ids.includes(item.id)} onChange={(e) => onChange(e.target.checked ? [...ids, item.id] : ids.length > 1 ? ids.filter((id) => id !== item.id) : ids)} />{item.name}</label>)}</fieldset>
}
function RuleEditor({ rule, profiles, servers, busy, error, onClose, onSave }: { rule: ApprovalRule; profiles: AccessProfile[]; servers: ServerRecord[]; busy: boolean; error: string; onClose: () => void; onSave: (rule: ApprovalRule) => void }) {
  const [draft, setDraft] = useState(rule), [discard, setDiscard] = useState(false), [localError, setLocalError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule)
  function dismiss() { if (!busy) { if (dirty) setDiscard(true); else onClose() } }
  const patch = (value: Partial<ApprovalRule>) => setDraft((old) => ({ ...old, ...value }))
  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (draft.expiresAt !== null && draft.expiresAt <= Date.now()) { setLocalError(msg('approvalSettings.chooseAFutureExpiryTimeOrDisableExpiry')); return }; onSave(draft) }
  return <><Dialog className="agent-dialog policy-editor" labelledBy="rule-title" onDismiss={dismiss}><form onSubmit={submit}>
    <header className="agent-dialog-header"><h2 id="rule-title">{rule.name ? msg('approvalSettings.editRule') : msg('approvalSettings.addRule')}</h2><button type="button" className="icon-button" aria-label={msg('approvalSettings.closeRule')} disabled={busy} onClick={dismiss}><X size={18} /></button></header>
    <fieldset disabled={busy} className="policy-form-fields">
      <label>{msg('approvalSettings.ruleName')}<input data-initial-focus required maxLength={100} value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder={msg('approvalSettings.ruleName2')} /></label>
      <label>{msg('approvalSettings.onMatch')}<select value={draft.action} onChange={(e) => patch({ action: e.target.value as ApprovalRule['action'], command: e.target.value === 'allow' && draft.command === null ? '' : draft.command })}><option value="approval">{msg('agentWorkspace.manualApproval')}</option><option value="allow">{msg('approvalSettings.automaticallyAllow')}</option><option value="deny">{msg('approvalSettings.denyExecution')}</option></select></label>
      <div className="policy-scopes"><ScopePicker label={msg('agentWorkspace.access')} ids={draft.profileIds} items={profiles} onChange={(profileIds) => patch({ profileIds })} /><ScopePicker label={msg('approvalSettings.server')} ids={draft.serverIds} items={servers} onChange={(serverIds) => patch({ serverIds })} /></div>
      {draft.action !== 'allow' && <label className="agent-check"><input type="checkbox" checked={draft.command === null} onChange={(e) => patch({ command: e.target.checked ? null : '' })} />{msg('approvalSettings.matchAllCommands')}</label>}
      {draft.command !== null && <label>{msg('agentWorkspace.fullCommand')}<textarea required rows={3} maxLength={16384} value={draft.command} onChange={(e) => patch({ command: e.target.value })} placeholder="pwd" /><small>{msg('approvalSettings.exactMatchIncludingWhitespaceAndNewlinesNoWildcards')}</small></label>}
      <label className="agent-check"><input type="checkbox" checked={draft.cwd !== null} onChange={(e) => patch({ cwd: e.target.checked ? '/' : null })} />{msg('approvalSettings.restrictRequestedDirectory')}</label>
      {draft.cwd !== null && <label>{msg('agentWorkspace.requestedDirectory')}<input required pattern="/.*" maxLength={4096} value={draft.cwd} onChange={(e) => patch({ cwd: e.target.value })} /></label>}
      <label className="agent-check"><input type="checkbox" checked={draft.expiresAt !== null} onChange={(e) => patch({ expiresAt: e.target.checked ? Date.now() + 3600000 : null })} />{msg('approvalSettings.setExpiry')}</label>
      {draft.expiresAt !== null && <label>{msg('approvalSettings.expiryTime')}<input type="datetime-local" required value={new Date(draft.expiresAt - new Date(draft.expiresAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => { if (e.target.value) patch({ expiresAt: new Date(e.target.value).getTime() }) }} /></label>}
      <label className="agent-check"><input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />{msg('approvalSettings.enableThisRule')}</label>
    </fieldset>
    {draft.action === 'allow' && <p className="operation-warning">{msg('approvalSettings.executesTheFullCommandDirectlyOnMatchVerify')}</p>}
    {(localError || error) && <p className="drawer-error" role="alert">{localError || error}</p>}
    <div className="agent-dialog-actions"><button type="button" className="credential-secondary" disabled={busy} onClick={dismiss}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy}>{busy ? msg('agentWorkspace.saving') : msg('approvalSettings.saveRule')}</button></div>
  </form></Dialog>{discard && <Dialog className="credential-confirm" labelledBy="rule-discard" onDismiss={() => setDiscard(false)}><h2 id="rule-discard">{msg('approvalSettings.discardUnsavedRule')}</h2><div className="confirm-actions"><button className="credential-secondary" onClick={() => setDiscard(false)}>{msg('agentWorkspace.keepEditing')}</button><button className="destructive-button" onClick={onClose}>{msg('agentWorkspace.discardChanges')}</button></div></Dialog>}</>
}
function PolicyPreview({ profiles, servers, onClose }: { profiles: AccessProfile[]; servers: ServerRecord[]; onClose: () => void }) {
  const [profileId, setProfileId] = useState(''), [decision, setDecision] = useState<PolicyDecision | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const mounted = useRef(true), generation = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const active = profiles.filter((p) => !p.revokedAt && (p.expiresAt === null || p.expiresAt > Date.now())), profile = active.find((p) => p.id === profileId)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget), current = ++generation.current
    setBusy(true); setError(''); setDecision(null)
    try { const result = unwrap(await api.previewApprovalPolicy({ profileId, serverId: String(data.get('serverId')), command: String(data.get('command')), cwd: String(data.get('cwd')) })); if (mounted.current && current === generation.current) setDecision(result) }
    catch (e) { if (mounted.current && current === generation.current) setError(e instanceof Error ? e.message : msg('approvalSettings.previewFailed')) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <Dialog className="agent-dialog" labelledBy="preview-title" onDismiss={onClose}><form onSubmit={(e) => void submit(e)} onChange={() => { generation.current++; setDecision(null); setError('') }}><h2 id="preview-title">{msg('approvalSettings.matchPreview')}</h2><p>{msg('approvalSettings.checksSavedPolicyOnlyNoServerConnectionOr')}</p><label>{msg('agentWorkspace.access')}<select required data-initial-focus value={profileId} onChange={(e) => setProfileId(e.target.value)}><option value="">{msg('approvalSettings.selectAccessProfile')}</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{!active.length && <p>{msg('approvalSettings.createAccessInAgentAccessFirst')}</p>}<label>{msg('approvalSettings.server')}<select name="serverId" key={profileId} required defaultValue=""><option value="">{msg('approvalSettings.selectServer')}</option>{servers.filter((s) => profile?.serverIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>{msg('agentWorkspace.requestedDirectory')}<input name="cwd" required pattern="/.*" defaultValue="/" /></label><label>{msg('agentWorkspace.fullCommand')}<textarea name="command" rows={3} required maxLength={16384} /></label>{error && <p className="drawer-error" role="alert">{error}</p>}{decision && <div className="policy-preview-result" role="status"><strong>{actions[decision.action]}</strong><p>{decision.reason}</p>{decision.matchedRules.map((r) => <p key={r.id}>{r.risk === 'high' ? msg('agentWorkspace.highRisk') : ''}{r.name} · {actions[r.action]}</p>)}<QueryChecks analysis={decision.queryAnalysis} /><small>{msg('approvalSettings.policyRevision')} {decision.revision} {msg('approvalSettings.connectionAndExecutionAreNotGuaranteed')}</small></div>}<div className="agent-dialog-actions"><button className="credential-secondary" type="button" onClick={onClose}>{msg('approvalSettings.close')}</button><button className="credential-primary" disabled={busy || !profile}>{busy ? msg('approvalSettings.matching') : msg('approvalSettings.checkMatch')}</button></div></form></Dialog>
}
