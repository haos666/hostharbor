import { msg, getLocale, errorText } from '../../../shared/i18n'
import { ProfileList } from './ProfileList'
import { TransferDetails } from './TransferDetails'
import { QueryChecks } from './QueryChecks'
import { OperationList, operationStateLabels } from './OperationList'
import { ApprovalReview } from './ApprovalReview'
import { McpToolBrowser } from './McpToolBrowser'
import { LogQueryDetails } from './LogQueryDetails'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Copy, Plus, X } from 'lucide-react'
import type { ApprovalNavigation, AccessProfile, AppStatus, McpStatus, Operation, OperationState, ProfileInput, ServerRecord } from '../../../shared/contracts'
import type { Result } from '../../../shared/errors'
import { localizedErrors as messages } from '../../../shared/i18n'
import { readOutputBurst } from '../output-reader'
import { Dialog } from './Dialog'
import { UnlockGate } from './SecuritySettings'

const api = window.hostharbor
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(errorText(result.error)); return result.value }
const labels = operationStateLabels
const ongoing = new Set<OperationState>(['awaiting_approval', 'queued', 'connecting', 'dispatching', 'running'])
export function AgentWorkspace({ notificationTarget, onNotificationHandled, kind, status, servers, onRefresh, onSetup }: { notificationTarget?: ApprovalNavigation | null; onNotificationHandled?: (sequence: number) => void; kind: 'connections' | 'operations'; status: AppStatus | null; servers: ServerRecord[]; onRefresh: () => Promise<void>; onSetup: () => void }) {
  const [connectionTab, setConnectionTab] = useState<'access' | 'tools'>('access')
  const handledNotification = useRef<number | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null), [operationsRevision, setOperationsRevision] = useState(0)
  const [mcp, setMcp] = useState<McpStatus>({ running: false, url: null })
  const [creating, setCreating] = useState(false), [token, setToken] = useState<string | null>(null), [copied, setCopied] = useState(false)
  const [selected, setSelected] = useState<string | null>(null), [output, setOutput] = useState('')
  const [outputTruncated, setOutputTruncated] = useState(false)
  const [editing, setEditing] = useState<AccessProfile | null>(null), [tokenSetup, setTokenSetup] = useState<AccessProfile | null>(null)
  const [installationCopied, setInstallationCopied] = useState<string | null>(null), [createdId, setCreatedId] = useState<string | null>(null)
  const [revoke, setRevoke] = useState<AccessProfile | null>(null), [deletingProfile, setDeletingProfile] = useState<AccessProfile | null>(null)
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const outputElement = useRef<HTMLPreElement>(null)
  const generation = useRef(0), current = useRef(status)
  current.current = status
  const unlocked = status?.vault === 'unlocked'
  useEffect(() => {
    const epoch = ++generation.current
    setToken(null); setCreatedId(null); setEditing(null); setTokenSetup(null); setInstallationCopied(null); setCreating(false); setSelected(null); setSelectedOperation(null); setOutput(''); setRevoke(null); setDeletingProfile(null); setError(null)
    if (!unlocked || kind !== 'connections') return
    let polling = false
    const refresh = async () => {
      if (polling) return
      polling = true
      try {
        const m = await api.mcpStatus()
        if (epoch !== generation.current || current.current?.vault !== 'unlocked') return
        setMcp(unwrap(m))
      } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : msg('agentWorkspace.cannotRefresh')) }
      finally { polling = false }
    }
    void refresh(); const timer = window.setInterval(() => void refresh(), 1500)
    return () => { generation.current++; window.clearInterval(timer) }
  }, [unlocked, status?.lockRevision, kind])
  useEffect(() => {
    if (kind !== 'operations' || !unlocked || !notificationTarget || handledNotification.current === notificationTarget.sequence) return
    handledNotification.current = notificationTarget.sequence
    onNotificationHandled?.(notificationTarget.sequence)
    setError(null); setSelectedOperation(null); setSelected(notificationTarget.operationId ?? null); setOperationsRevision(n => n + 1)
  }, [kind, unlocked, status?.lockRevision, notificationTarget?.sequence])
  useEffect(() => {
    setOutput(''); setOutputTruncated(false)
    if (!selected || !unlocked) return
    let disposed = false, cursor = 0, polling = false, finished = false, displayed = ''
    let continuation: number | undefined
    const read = async () => {
      if (polling || finished || disposed) return
      polling = true
      try {
        const batch = await readOutputBurst(async (next) => unwrap(await api.readOperationOutput({ id: selected, cursor: next })), cursor, (chunks, nextCursor) => {
          cursor = nextCursor
          const text = displayed + chunks.map((chunk) => chunk.text).join('')
          if (text.length > 1048576) setOutputTruncated(true)
          displayed = text.slice(-1048576); setOutput(displayed)
        }, () => disposed)
        if (disposed) return
        cursor = batch.cursor; finished = batch.finished
        if (batch.more) continuation = window.setTimeout(() => void read(), 0)
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : msg('agentWorkspace.cannotReadOutput')) }
      finally { polling = false }
    }
    void read(); const timer = window.setInterval(() => void read(), 1000)
    return () => { disposed = true; window.clearInterval(timer); window.clearTimeout(continuation) }
  }, [selected, unlocked])
  useEffect(() => {
    if (!selected || !unlocked) return
    let disposed = false, pending = false
    const refresh = async () => {
      if (pending) return; pending = true
      try {
        const result = await api.getOperation(selected)
        if (disposed) return
        if (!result.ok) { setError(errorText(result.error)); setSelected(null); setSelectedOperation(null); return }
        setSelectedOperation(result.value)
      } catch { if (!disposed) setError(msg('agentWorkspace.cannotRefreshOperationDetails')) } finally { pending = false }
    }
    void refresh(); const timer = window.setInterval(() => void refresh(), 1000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [selected, unlocked, operationsRevision])
  async function run(job: () => Promise<void>) {
    if (busy) return
    const epoch = generation.current; setBusy(true); setError(null)
    try {
      await job()
      if (epoch !== generation.current) return
      const m = await api.mcpStatus()
      if (epoch !== generation.current) return
      setMcp(unwrap(m)); setOperationsRevision(n => n + 1); await onRefresh()
    } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : msg('agentWorkspace.operationFailed')) }
    finally { setBusy(false) }
  }
  async function copyInstallation(profile: AccessProfile) {
    if (!profile.hasSavedToken) { setError(null); setTokenSetup(profile); return }
    await run(async () => { const epoch = generation.current; unwrap(await api.copyMcpInstallation(profile.id)); if (epoch === generation.current) setInstallationCopied(profile.id) })
  }
  useEffect(() => { if (!installationCopied) return; const timer = window.setTimeout(() => setInstallationCopied(null), 3000); return () => clearTimeout(timer) }, [installationCopied])
  const operation = selectedOperation?.id === selected ? selectedOperation : null
  return <section className={`agent-workspace ${kind === 'connections' ? 'connections-workspace' : ''}${kind === 'operations' && unlocked ? ' history-workspace' : ''}`}>
    <header className="credentials-header"><div className="credentials-title"><span className="page-label">{msg('agentWorkspace.localMcp')}</span><h1>{kind === 'connections' ? msg('agentWorkspace.agentAccess') : msg('agentWorkspace.approvals')}</h1></div>{unlocked && kind === 'connections' && connectionTab === 'access' && <button className="credential-primary" onClick={() => { setError(null); setCreating(true) }}><Plus size={16} />{msg('agentWorkspace.createAccess')}</button>}</header>
    {kind === 'connections' && <div className="mcp-tabs" role="tablist" aria-label={msg('agentWorkspace.agentAccessCategories')} ref={tabsRef} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); const next = event.key === 'Home' ? 'access' : event.key === 'End' ? 'tools' : connectionTab === 'access' ? 'tools' : 'access'
      setConnectionTab(next); tabsRef.current?.querySelector<HTMLButtonElement>(`#mcp-${next}-tab`)?.focus()
    }}><button role="tab" id="mcp-access-tab" aria-controls="mcp-access-panel" aria-selected={connectionTab === 'access'} tabIndex={connectionTab === 'access' ? 0 : -1} onClick={() => setConnectionTab('access')}>{msg('agentWorkspace.accessManagement')}</button><button role="tab" id="mcp-tools-tab" aria-controls="mcp-tools-panel" aria-selected={connectionTab === 'tools'} tabIndex={connectionTab === 'tools' ? 0 : -1} onClick={() => setConnectionTab('tools')}>{msg('agentWorkspace.toolCatalog')}</button></div>}
    {error && <div className="credential-notice is-error" role="alert"><span>{error}</span><button aria-label={msg('agentWorkspace.dismissMessage')} onClick={() => setError(null)}><X size={16} /></button></div>}
    {kind === 'connections' && connectionTab === 'tools' ? <McpToolBrowser /> : !unlocked ? <div role="tabpanel" id="mcp-access-panel" aria-labelledby="mcp-access-tab"><UnlockGate status={status} onRefresh={onRefresh} onSetup={onSetup} /></div> : kind === 'connections' ? <div className="access-panel" role="tabpanel" id="mcp-access-panel" aria-labelledby="mcp-access-tab">
      <div className="mcp-service"><div><div className="mcp-service-heading"><span className={`mcp-dot ${mcp.running ? 'on' : ''}`} /><strong>{mcp.running ? msg('agentWorkspace.localServiceIsRunning') : msg('agentWorkspace.localServiceIsStopped')}</strong></div><p>{mcp.url ?? 'http://127.0.0.1:43821/mcp'}</p></div><button className={mcp.running ? 'credential-secondary' : 'credential-primary'} disabled={busy} onClick={() => void run(async () => { if (mcp.running) unwrap(await api.stopMcp()); else unwrap(await api.startMcp()) })}>{mcp.running ? msg('agentWorkspace.stopService') : msg('agentWorkspace.startService')}</button></div>
      <p className="agent-hint">{msg('agentWorkspace.copyTheInstallationConfigurationToYourLocalAgent')}</p>
      <ProfileList servers={servers} revision={operationsRevision} busy={busy} copied={installationCopied} onEdit={p => { setError(null); setEditing(p) }} onCopy={p => void copyInstallation(p)} onRevoke={p => { setError(null); setRevoke(p) }} onDelete={p => { setError(null); setDeletingProfile(p) }} />
    </div> : <>
      <OperationList revision={operationsRevision} onSelect={o => { setError(null); setSelectedOperation(o); setSelected(o.id) }} />
    </>}
    {unlocked && creating && <ProfileEditor servers={servers} busy={busy} error={error} onClose={() => setCreating(false)} onCreate={(input) => void run(async () => { const epoch = generation.current; const result = unwrap(await api.createProfile(input)); if (epoch === generation.current) { setCreating(false); setToken(result.token); setCreatedId(result.profile.id); setCopied(false) } })} />}
    {unlocked && editing && <ProfileEditor key={editing.id} profile={editing} servers={servers} busy={busy} error={error} onClose={() => setEditing(null)} onCreate={input => void run(async () => { unwrap(await api.updateProfile({ id: editing.id, revision: editing.revision, name: input.name, serverIds: input.serverIds, expiresAt: input.expiresAt })); setEditing(null); setInstallationCopied(null) })} />}
    {unlocked && tokenSetup && <LegacyTokenDialog profile={tokenSetup} busy={busy} error={error} onClose={() => setTokenSetup(null)} onSubmit={input => void run(async () => {
      const epoch = generation.current
      unwrap(await api.prepareProfileToken({ id: tokenSetup.id, revision: tokenSetup.revision, ...input }))
      unwrap(await api.copyMcpInstallation(tokenSetup.id))
      if (epoch === generation.current) { setInstallationCopied(tokenSetup.id); setTokenSetup(null) }
    })} />}
    {unlocked && token && <Dialog className="agent-dialog" labelledBy="token-title" onDismiss={() => setToken(null)}><h2 id="token-title">{msg('agentWorkspace.accessCreated')}</h2><p>{msg('agentWorkspace.copyTheFullInstallationConfigurationToYourLocal')}</p><input aria-label={msg('agentWorkspace.accessToken')} readOnly type="password" value={token} />{error && <p role="alert">{error}</p>}<div className="agent-dialog-actions">{createdId && <button className="credential-primary" disabled={busy} onClick={() => void run(async () => { const epoch = generation.current; unwrap(await api.copyMcpInstallation(createdId)); if (epoch === generation.current) setInstallationCopied(createdId) })}>{installationCopied === createdId ? msg('agentWorkspace.configurationCopied') : msg('agentWorkspace.copyInstallationConfiguration')}</button>}<button className="credential-secondary" onClick={() => { void api.copyAccessToken(token).then((result) => { unwrap(result); setCopied(true) }).catch(() => setError(msg('agentWorkspace.copyFailedSelectTheTokenManually'))) }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? msg('agentWorkspace.copied') : msg('agentWorkspace.copyToken')}</button><button className="credential-primary" onClick={() => setToken(null)}>{msg('agentWorkspace.saved')}</button></div></Dialog>}
    {unlocked && deletingProfile && <Dialog className="agent-dialog" labelledBy="delete-profile-title" onDismiss={() => { if (!busy) setDeletingProfile(null) }}><h2 id="delete-profile-title">{msg('common.deleteNamed', { name: deletingProfile.name })}</h2><p>{msg('agentWorkspace.moveThisAccessToDeletedAndImmediatelyInvalidate')}</p>{error && <p role="alert" className="dialog-error">{error}</p>}<div className="agent-dialog-actions"><button className="credential-secondary" disabled={busy} onClick={() => setDeletingProfile(null)}>{msg('agentWorkspace.cancel')}</button><button className="destructive-button" disabled={busy} onClick={() => void run(async () => { unwrap(await api.deleteProfile({ id: deletingProfile.id, revision: deletingProfile.revision })); setDeletingProfile(null); setInstallationCopied(null) })}>{msg('agentWorkspace.deleteAccess')}</button></div></Dialog>}
    {unlocked && revoke && <Dialog className="agent-dialog" labelledBy="revoke-title" onDismiss={() => setRevoke(null)}><h2 id="revoke-title">{msg('common.revokeNamed', { name: revoke.name })}</h2><p>{msg('agentWorkspace.theTokenBecomesInvalidImmediatelyPendingTasksStop')}</p>{error && <p role="alert" className="dialog-error">{error}</p>}<div className="agent-dialog-actions"><button className="credential-secondary" onClick={() => setRevoke(null)}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy} onClick={() => void run(async () => { unwrap(await api.revokeProfile(revoke.id)); setRevoke(null) })}>{msg('agentWorkspace.revokeAccess')}</button></div></Dialog>}
    {unlocked && operation && <Dialog className="agent-dialog operation-dialog" labelledBy="operation-title" onDismiss={() => setSelected(null)}><header className="agent-dialog-header"><h2 id="operation-title">{labels[operation.state]}</h2><button className="icon-button" aria-label={msg('agentWorkspace.closeOperationDetails')} onClick={() => setSelected(null)}><X size={18} /></button></header>
      <dl className="operation-details"><dt>{msg('agentWorkspace.access')}</dt><dd>{operation.profileName}</dd><dt>{msg('agentWorkspace.targetAndRoute')}</dt><dd>{operation.routeServers.map((s) => `${s.name} · ${s.username}@${s.host}:${s.port} (v${s.revision})`).join(' ← ')}{operation.target.route.type === 'socks5' && <div>SOCKS5 {operation.target.route.host}:{operation.target.route.port}{operation.target.route.authentication.type === 'password' ? ` · ${operation.target.route.authentication.username}` : ''}</div>}</dd><dt>{msg('agentWorkspace.boundCredentials')}</dt><dd>{operation.dependencies.map((d) => `${d.name} (v${d.revision})`).join(msg('common.listSeparator'))}</dd><dt>{msg('agentWorkspace.executionIdentity')}</dt><dd>{operation.input.elevation === 'sudo' ? msg('agentWorkspace.sudoRootApprovalPolicyAppliesAuthenticationHandledIn') : msg('agentWorkspace.sshLoginAccount')}</dd><dt>{msg('agentWorkspace.requestedDirectory')}</dt><dd><code>{operation.input.cwd}</code></dd><dt>{msg('agentWorkspace.remoteConfirmedDirectory')}</dt><dd>{operation.confirmedCwd ?? msg('agentWorkspace.notYetConfirmed')}</dd><dt>{msg('agentWorkspace.timeout')}</dt><dd>{msg('agentWorkspace.connect')} {operation.input.connectTimeoutMs / 1000}{msg('agentWorkspace.sExecute')} {(operation.transfer?.totalTimeoutMs ?? operation.input.timeoutMs) / 1000}s</dd><dt>{msg('agentWorkspace.exitCode')}</dt><dd>{operation.exitCode ?? msg('agentWorkspace.notReceived')}</dd></dl>
      <div className="policy-preview-result"><strong>{msg('agentWorkspace.approvalDecision')}{operation.decision ? ({ allow: msg('agentWorkspace.automaticallyAllowed'), approval: msg('agentWorkspace.manualApproval'), deny: msg('agentWorkspace.deniedByPolicy') })[operation.decision.action] : msg('agentWorkspace.legacyAccessPolicy')}</strong>{operation.decision && <><p>{operation.decision.reason} {msg('agentWorkspace.policyRevision')} {operation.decision.revision}</p>{operation.decision.matchedRules.map((r) => <p key={r.id}>{r.risk === 'high' ? msg('agentWorkspace.highRisk') : ''}{r.name} · {({ allow: msg('agentWorkspace.allow'), approval: msg('agentWorkspace.approve'), deny: msg('agentWorkspace.deny') })[r.action]}</p>)}</>}</div>
      <TransferDetails operation={operation} /><LogQueryDetails operation={operation} />
      <ApprovalReview review={operation.decision?.aiReview} stopped={operation.state !== 'awaiting_approval'} />
      <label>{operation.transfer ? msg('agentWorkspace.fileOperation') : msg('agentWorkspace.fullCommand')}</label><pre className="operation-command">{operation.input.command}</pre>
      <QueryChecks analysis={operation.decision?.queryAnalysis} />
    {operation.decision?.queryPlan && <details><summary>{msg('agentWorkspace.verifiedQueryToExecute')}</summary><pre className="operation-command">{operation.decision.queryPlan.command}</pre></details>}
      {operation.state === 'unknown' && <p role="alert" className="operation-warning">{operation.transfer ? msg('agentWorkspace.finalFilePublicationIsUnconfirmedCheckTheDestination') : msg('agentWorkspace.disconnectedTheRemoteOutcomeAndProcessStateAre')}</p>}
      {operation.errorCode && !operation.fileResult?.failure && <p className="operation-warning">{msg('agentWorkspace.reason')}{messages[operation.errorCode as keyof typeof messages] ?? operation.errorCode}</p>}
      {error && <p role="alert" className="dialog-error">{error}</p>}
      <div className="operation-output-header"><span>{msg('agentWorkspace.output')}</span>{output.length > 3000 && <button className="credential-secondary" onClick={() => { const element = outputElement.current; if (element) { element.scrollTop = element.scrollHeight; element.focus() } }}>{msg('agentWorkspace.jumpToEnd')}</button>}</div>{outputTruncated && <p>{msg('agentWorkspace.longOutputOnlyTheTailIsDisplayed')}</p>}{operation.replayClearedAt && <p>{msg('agentWorkspace.replayOutputWasClearedManuallyOrByRetention')}</p>}<pre ref={outputElement} tabIndex={0} aria-label={msg('agentWorkspace.commandOutput')} className="operation-output">{output || msg('agentWorkspace.noOutputYet')}</pre>
      <div className="agent-dialog-actions">{operation.state === 'awaiting_approval' ? <><button className="credential-secondary" disabled={busy} onClick={() => void run(async () => { unwrap(await api.decideOperation({ id: operation.id, approve: false })) })}>{msg('agentWorkspace.deny')}</button><button className="credential-primary" disabled={busy} onClick={() => void run(async () => { unwrap(await api.decideOperation({ id: operation.id, approve: true })) })}>{msg('agentWorkspace.allowThisCommand')}</button></> : ongoing.has(operation.state) && <button className="credential-secondary" disabled={busy} onClick={() => void run(async () => { unwrap(await api.cancelOperation(operation.id)) })}>{msg('agentWorkspace.requestCancellation')}</button>}</div>
    </Dialog>}
  </section>
}
function ProfileEditor({ profile, servers, busy, error, onClose, onCreate }: { profile?: AccessProfile; servers: ServerRecord[]; busy: boolean; error: string | null; onClose: () => void; onCreate: (input: ProfileInput) => void }) {
  const [ids, setIds] = useState<string[]>(profile?.serverIds ?? [])
  const [discard, setDiscard] = useState(false), dirty = useRef(false)
  function dismiss() { if (busy) return; if (dirty.current) setDiscard(true); else onClose() }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    onCreate({ name: String(data.get('name')), serverIds: ids, mode: 'policy', expiresAt: data.get('duration') === 'keep' ? profile!.expiresAt : data.get('duration') === 'permanent' ? null : Date.now() + Number(data.get('duration')) * 60000 })
  }
  return <><Dialog className="agent-dialog profile-editor" labelledBy="profile-title" onDismiss={dismiss}><form onSubmit={submit} onChange={() => { dirty.current = true }}>
    <div className="profile-scroll"><fieldset className="profile-fields" disabled={busy}>
    <h2 id="profile-title">{profile ? msg('agentWorkspace.editAgentAccess') : msg('agentWorkspace.createAgentAccess')}</h2>
    <label>{msg('agentWorkspace.name')}<input data-initial-focus name="name" required maxLength={100} defaultValue={profile?.name} placeholder={msg('agentWorkspace.accessName')} /></label>
    <fieldset><legend>{msg('agentWorkspace.accessibleServersSelected')} {ids.length} {msg('agentWorkspace.servers')}</legend>{servers.filter(s => s.credentialId).length === 0 && <p>{msg('agentWorkspace.addAServerAndBindCredentialsFirst')}</p>}{servers.filter(s => s.credentialId || ids.includes(s.id)).map(s => <label className="agent-check" key={s.id}><input type="checkbox" checked={ids.includes(s.id)} onChange={e => setIds(old => e.target.checked ? [...old, s.id] : old.filter(id => id !== s.id))} />{s.name}<small>{s.credentialId ? s.host : msg('agentWorkspace.credentialsMustBeRebound')}</small></label>)}{ids.filter(id => !servers.some(s => s.id === id)).map(id => <label className="agent-check" key={id}><input type="checkbox" checked onChange={() => setIds(old => old.filter(value => value !== id))} />{msg('agentWorkspace.deletedServer')}<small>{msg('agentWorkspace.removeThisAuthorization')}</small></label>)}</fieldset>
    <p className="agent-hint">{msg('agentWorkspace.executionFollowsTheApprovalPolicyInSettingsUploads')}</p>
    <label>{msg('agentWorkspace.validity')}<select name="duration" defaultValue={profile ? 'keep' : '10080'}>{profile && <option value="keep">{profile.expiresAt === null ? msg('agentWorkspace.keepPermanentAccess') : msg('agentWorkspace.keepCurrentExpiryValue', { value0: new Date(profile.expiresAt).toLocaleString(getLocale()) })}</option>}<option value="10080">{msg('agentWorkspace.7Days')}</option><option value="43200">{msg('agentWorkspace.30Days')}</option><option value="permanent">{msg('agentWorkspace.permanent')}</option></select></label>
    {profile && <p className="agent-hint">{msg('agentWorkspace.savingStopsUnfinishedTasksAndDisconnectsThisAccess')}</p>}
    {error && <p role="alert" className="dialog-error">{error}</p>}</fieldset></div><div className="agent-dialog-actions"><button className="credential-secondary" type="button" disabled={busy} onClick={dismiss}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy || ids.length === 0}>{busy ? msg('agentWorkspace.saving') : profile ? msg('agentWorkspace.saveChanges') : msg('agentWorkspace.createAccess')}</button></div>
  </form></Dialog>{discard && <Dialog className="credential-confirm" labelledBy="profile-discard-title" onDismiss={() => setDiscard(false)}><h2 id="profile-discard-title">{msg('agentWorkspace.discardUnsavedChanges')}</h2><p>{msg('agentWorkspace.theseAccessChangesWillNotBeSaved')}</p><div className="confirm-actions"><button className="quiet-button" data-initial-focus onClick={() => setDiscard(false)}>{msg('agentWorkspace.keepEditing')}</button><button className="destructive-button" onClick={onClose}>{msg('agentWorkspace.discardChanges')}</button></div></Dialog>}</>
}
function LegacyTokenDialog({ profile, busy, error, onClose, onSubmit }: { profile: AccessProfile; busy: boolean; error: string | null; onClose: () => void; onSubmit: (input: { token?: string; regenerate?: true }) => void }) {
  const [regenerate, setRegenerate] = useState(false)
  return <Dialog className="agent-dialog" labelledBy="legacy-token-title" onDismiss={onClose}><form onSubmit={event => {
    event.preventDefault(); const form = event.currentTarget; const token = String(new FormData(form).get('originalToken') ?? '')
    onSubmit(regenerate ? { regenerate: true } : { token }); form.reset()
  }}><h2 id="legacy-token-title">{msg('agentWorkspace.copy')} {profile.name} {msg('agentWorkspace.installationConfiguration')}</h2><p>{msg('agentWorkspace.legacyAccessStoredOnlyATokenHashEnter')}</p>
    <label className="agent-check"><input type="checkbox" checked={regenerate} onChange={event => setRegenerate(event.target.checked)} />{msg('agentWorkspace.originalTokenLostRegenerate')}</label>
    {regenerate ? <p className="operation-warning">{msg('agentWorkspace.regenerationImmediatelyInvalidatesTheOriginalTokenUpdateExisting')}</p> : <label>{msg('agentWorkspace.originalToken')}<input data-initial-focus name="originalToken" type="password" required autoComplete="off" /></label>}
    {error && <p role="alert" className="dialog-error">{error}</p>}<div className="agent-dialog-actions"><button type="button" className="credential-secondary" onClick={onClose}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy}>{regenerate ? msg('agentWorkspace.regenerateAndCopy') : msg('agentWorkspace.verifyAndCopy')}</button></div>
  </form></Dialog>
}
