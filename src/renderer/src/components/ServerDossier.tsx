import { msg, getLocale, errorText } from '../../../shared/i18n'
import { useEffect, useRef, useState } from 'react'
import { Bot, Check, ChevronRight, Clock3, Database, Folder, LoaderCircle, ShieldCheck, Pencil, Server, X } from 'lucide-react'
import type { AiSettings, Operation, ServerRecord } from '../../../shared/contracts'
import { isInvestigating, type InvestigationView, type InvestigationEvidence } from '../../../shared/dossier'
import { systemFields } from '../catalog'
import type { Result } from '../../../shared/errors'
import { localizedErrors as messages } from '../../../shared/i18n'
import { DossierEditor } from './DossierEditor'
import { ApplicationsPanel } from './ApplicationsPanel'
import { Dialog } from './Dialog'
const api = window.hostharbor
const confidence = { get evidenced() { return msg('serverDossier.evidenceCited') }, get inferred() { return msg('serverDossier.inferred') }, get unknown() { return msg('serverDossier.toVerify') } }
const kinds = { get application() { return msg('dossierEditor.applicationDirectory') }, get working() { return msg('dossierEditor.workingDirectory') }, get data() { return msg('dossierEditor.dataDirectory') }, get container() { return msg('dossierEditor.insideContainer') }, get 'host-mount'() { return msg('dossierEditor.hostMount') } }
function unwrap<T>(r: Result<T>): T { if (!r.ok) throw new Error(errorText(r.error)); return r.value }
function EvidenceLinks({ ids, select }: { ids: string[]; select: (id: string) => void }) {
  return <span className="dossier-refs">{ids.map((id, i) => <button key={id} title={msg('serverDossier.viewCollectedEvidence')} aria-label={msg('serverDossier.viewEvidenceValue', { value0: i + 1 })} onClick={() => select(id)}>{msg('serverDossier.evidence')}{i + 1}</button>)}</span>
}
export function ServerDossier({ server, onClose }: { server: ServerRecord; onClose: () => void }) {
  const [view, setView] = useState<InvestigationView | null>(null), [config, setConfig] = useState<AiSettings | null>(null)
  const [operation, setOperation] = useState<Operation | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reuse, setReuse] = useState(false), [baselineOnly, setBaselineOnly] = useState(false)
  const [confirm, setConfirm] = useState(false), [ack, setAck] = useState(false), [selected, setSelected] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null), startRef = useRef<HTMLElement>(null)
  const epoch = useRef(0), alive = useRef(true)
  useEffect(() => {
    alive.current = true; let timer: number | undefined
    const current = ++epoch.current
    async function refresh() {
      try {
        const next = unwrap(await api.getServerDossier(server.id))
        const settings = unwrap(await api.getAiSettings())
        const op = next.run?.operationId ? unwrap(await api.getOperation(next.run.operationId)) : null
        if (current !== epoch.current) return
        setView(next); setConfig(settings); setOperation(op)
        if (isInvestigating(next.run)) timer = window.setTimeout(() => void refresh(), 800)
      } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : msg('aiSettings.loadFailed')) }
    }
    void refresh()
    return () => { alive.current = false; epoch.current++; window.clearTimeout(timer) }
  }, [server.id, busy])
  async function action(kind: 'start' | 'cancel' | 'approve' | 'reject') {
    if (busy || !config) return
    setBusy(true); setError('')
    try {
      if (kind === 'start') {
        const next = unwrap(await api.startInvestigation({ serverId: server.id, serverRevision: server.revision, aiRevision: config.revision, reuseEvidence: reuse, baselineOnly: reuse && baselineOnly }))
        if (alive.current) { setView(next); setConfirm(false); setAck(false) }
      } else if (kind === 'cancel') { const next = unwrap(await api.cancelInvestigation(server.id)); if (alive.current) setView(next) }
      else if (operation) unwrap(await api.decideOperation({ id: operation.id, approve: kind === 'approve' }))
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : msg('agentWorkspace.operationFailed')) }
    finally { if (alive.current) setBusy(false) }
  }
  const run = view?.run, report = view?.report, running = isInvestigating(run ?? null)
  useEffect(() => { if (confirm) startRef.current?.scrollIntoView({ block: 'start' }); else if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [confirm, run?.id])
  useEffect(() => { if (error && bodyRef.current) bodyRef.current.scrollTop = 0 }, [error])
  const active = config?.activeProvider ? config.providers[config.activeProvider] : null
  const evidence = selected ? [...(run?.evidence ?? []), ...(report?.evidence ?? [])].find(e => e.id === selected) : null
  const runError = run?.errorCode ? messages[run.errorCode as keyof typeof messages] ?? msg('serverDossier.investigationIncomplete') : null
  const selectEvidence = (id: string) => setSelected(id)
  const manual = (field: string) => report?.manualFields?.includes(field) ?? false
  const source = (field: string, fact: { confidence: keyof typeof confidence; evidenceIds: string[] }) => <><span className={`dossier-confidence ${manual(field) ? 'manual' : fact.confidence}`}>{manual(field) ? msg('serverDossier.manualCorrection') : confidence[fact.confidence]}</span>{!manual(field) && <EvidenceLinks ids={fact.evidenceIds} select={selectEvidence} />}</>
  return <Dialog className="dossier-dialog" labelledBy="dossier-title" onDismiss={onClose}>
    <header className="dossier-header"><span className="dossier-bot"><Bot size={22} /></span><div><span className="page-label">{msg('serverDossier.serverDossier')}</span><h2 id="dossier-title">{server.name}</h2></div>{report && <button className="credential-secondary dossier-edit-button" disabled={busy || running || confirm} onClick={() => setEditing(true)}><Pencil size={14} />{msg('dossierEditor.editDossier')}</button>}<button className="icon-button" aria-label={msg('serverDossier.closeServerDossier')} onClick={onClose}><X size={20} /></button></header>
    <div className="dossier-body" ref={bodyRef}>
      {error && <p className="drawer-error" role="alert">{error}</p>}
      {running && <div className="dossier-progress" role="status"><LoaderCircle size={17} className="dossier-spin" /><div><strong>{run?.state === 'analyzing' ? msg('investigation.analyzing') : run?.state === 'awaiting_approval' ? msg('investigation.awaitingApproval') : msg('investigation.collecting')}</strong><small>{msg('serverDossier.collected')} {run?.evidence.length ?? 0} {msg('serverDossier.itemsContinuesAfterClosingReturnAtAnyTime')}</small></div><button className="credential-secondary" disabled={busy} onClick={() => void action('cancel')}>{msg('serverDossier.stop')}</button></div>}
      {!running && runError && <div className="dossier-run-error" role="status">{runError}{run?.diagnostic && <details><summary>{msg('serverDossier.protocolDiagnostics')}</summary><code>{run.diagnostic}</code></details>}{report && <small>{msg('serverDossier.theLastSuccessfulDossierRemainsBelow')}</small>}</div>}
      {running && operation?.state === 'awaiting_approval' && <section className="dossier-approval"><h3><ShieldCheck size={17} />{msg('serverDossier.queryAwaitingApproval')}</h3><p>{msg('dossierEditor.workingDirectory')} <code>{operation.input.cwd}</code> {msg('serverDossier.timeout')} {operation.input.timeoutMs / 1000} {msg('serverDossier.seconds')}</p><pre>{operation.input.command}</pre><details><summary>{msg('serverDossier.targetAndConnectionRoute')}</summary><p>{operation.target.host}:{operation.target.port} · {operation.target.username}</p>{operation.routeServers.map(s => <p key={s.id}>{s.name} · {s.host}:{s.port} · {s.username} · {s.route.type}</p>)}<pre>{JSON.stringify(operation.routeServers.map(s => ({ name: s.name, route: s.route })), null, 2)}</pre><small>{msg('serverDossier.credentialRevisions')}{operation.dependencies.map(d => `${d.name} v${d.revision}`).join(msg('common.listSeparator'))}</small></details><div className="dossier-actions"><button className="credential-secondary" disabled={busy} onClick={() => void action('reject')}>{msg('serverDossier.rejectAndStop')}</button><button className="credential-primary" disabled={busy} onClick={() => void action('approve')}><Check size={14} />{msg('serverDossier.approveThisQuery')}</button></div></section>}
      {run?.validationOnly && run.state === 'completed' && <p className="credential-notice" role="status">{msg('serverDossier.baselineSummaryValidationPassedOriginalDossierRetained')}</p>}
      {report ? <>
        <div className="dossier-meta"><span><Clock3 size={13} />{new Date(report.collectedAt).toLocaleString(getLocale())}</span><span>{report.model}</span><span>{report.evidence.length} {msg('serverDossier.collectedItems')}</span>{!!report.manualFields?.length && <span>{msg('serverDossier.manualCorrection2')} {new Date(view!.corrections!.updatedAt).toLocaleString(getLocale())}</span>}{(report.stale || report.serverRevision !== server.revision) && <span className="dossier-stale">{msg('serverDossier.connectionChangedANewInvestigationIsRecommended')}</span>}</div>
        <section className="dossier-section dossier-summary"><h3>{msg('dossierEditor.overview')}{manual('overview') && <span className="dossier-confidence manual">{msg('serverDossier.manualCorrection')}</span>}</h3><p className="dossier-overview">{report.content.overview}</p></section>
        <section className="dossier-section"><h3><Server size={16} />{msg('dossierEditor.systemInformation')}</h3><dl className="dossier-facts">{systemFields.map(({ key, label }) => { const fact = report.content.system[key]; return <div key={key}><dt>{label}</dt><dd><span>{fact.value}</span><div className="dossier-fact-source">{source(`system.${key}`, fact)}</div></dd></div> })}</dl></section>
        <section className="dossier-section"><h3><Database size={16} />{msg('dossierEditor.disksAndMounts')}<span>{report.content.disks.length}</span>{manual('disks') && <span className="dossier-confidence manual">{msg('serverDossier.manualCorrection')}</span>}</h3>{report.content.disks.length ? <div className="dossier-table-scroll"><table><thead><tr><th>{msg('dossierEditor.mountPoint')}</th><th>{msg('dossierEditor.capacity')}</th><th>{msg('serverDossier.used')}</th><th>{msg('serverDossier.basis')}</th></tr></thead><tbody>{report.content.disks.map((d, i) => <tr key={i}><td><code>{d.mount}</code></td><td>{d.size}</td><td>{d.used}</td><td>{source('disks', d)}</td></tr>)}</tbody></table></div> : <p className="dossier-muted">{msg('serverDossier.diskInformationUnconfirmed')}</p>}</section>
        <section className="dossier-section"><h3><Bot size={16} />{msg('dossierEditor.deployedApplications')}<span>{report.content.applications.length}</span>{manual('applications') && <span className="dossier-confidence manual">{msg('serverDossier.manualCorrection')}</span>}</h3>{report.content.applications.length ? <div className="dossier-apps">{report.content.applications.map((a, i) => <article key={i}><header><strong>{a.name}</strong>{source('applications', a)}</header><div className="dossier-app-meta"><span>{a.type}</span><span>{a.status}</span></div><div className="dossier-ports"><small>{msg('applicationsPanel.port')}</small>{a.ports.length ? a.ports.map((p, j) => <code key={j}>{p}</code>) : <span>{msg('applicationsPanel.unconfirmed')}</span>}</div>{a.directories.length ? <details className="dossier-directories"><summary><ChevronRight size={14} aria-hidden="true" /><span>{msg('historyPage.directory')}</span><small>{a.directories.length} {msg('approvalSettings.items')}</small></summary><ul className="dossier-paths">{a.directories.map((d, j) => <li key={j}><Folder size={13} /><small>{kinds[d.kind]}</small><code>{d.path}</code>{source('applications', d)}</li>)}</ul></details> : <p className="dossier-muted">{msg('serverDossier.deploymentDirectoriesUnconfirmed')}</p>}</article>)}</div> : <p className="dossier-muted">{msg('serverDossier.runningApplicationsAreUnconfirmedThisDoesNotImply')}</p>}</section>
        <section className="dossier-section dossier-unknowns"><h3>{msg('dossierEditor.itemsToVerify')}<span>{report.content.unknowns.length}</span>{manual('unknowns') && <span className="dossier-confidence manual">{msg('serverDossier.manualCorrection')}</span>}</h3>{report.content.unknowns.length ? <ul>{report.content.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul> : <p className="dossier-muted">{msg('serverDossier.theModelListedNoFurtherItemsToVerify')}</p>}</section>
        <details className="dossier-evidence-list"><summary>{msg('serverDossier.collectionRecordsAndEvidence')} {report.evidence.length} {msg('approvalSettings.items')}</summary>{report.evidence.map(e => <EvidenceRow key={e.id} evidence={e} onClick={() => selectEvidence(e.id)} />)}</details>
        <p className="dossier-footnote">{msg('serverDossier.aiSummariesMayBeIncorrectEvidenceCitedMeans')}</p>
      </> : !running && view && !(run?.evidence.length) && <div className="dossier-empty"><span><Bot size={40} strokeWidth={1.3} /></span><h3>{msg('serverDossier.understandThisServer')}</h3><p>{msg('serverDossier.systemResourcesServicesDeploymentDirectoriesAndPortsIn')}</p><div><span>{msg('serverDossier.01BaselineCollection')}</span><span>{msg('serverDossier.02AiInvestigation')}</span><span>{msg('serverDossier.03SaveStructuredDossier')}</span></div></div>}
      {!report && !running && !!run?.evidence.length && <section className="dossier-partial"><h3>{msg('serverDossier.baselineCollectedAiSummaryIncomplete')}</h3><p>{msg('serverDossier.retained')} {run.evidence.length} {msg('serverDossier.collectionRecordsSummarizeThemWithoutReconnectingToThe')}</p><button className="credential-primary" disabled={busy || !active} onClick={() => { setReuse(true); setBaselineOnly(false); setConfirm(true); setAck(false) }}>{msg('serverDossier.summarizeSavedCollection')}</button></section>}
      {run && run.evidence.length > 0 && (!report || run.id !== report.runId) && <details className="dossier-evidence-list" open={!running && !report}><summary>{msg('serverDossier.currentCollection')} {run.evidence.length} {msg('approvalSettings.items')}</summary>{run.evidence.map(e => <EvidenceRow key={e.id} evidence={e} onClick={() => selectEvidence(e.id)} />)}</details>}
      {view && <ApplicationsPanel serverId={server.id} serverRevision={server.revision} report={report ?? null} />}
      {confirm && <section className="dossier-start" ref={startRef}><h3>{reuse ? baselineOnly ? msg('serverDossier.validateTwoBaselineSummaries') : msg('serverDossier.summarizeSavedInformation') : report ? msg('serverDossier.updateServerDossier') : msg('serverDossier.startAiInvestigation')}</h3><p>{msg('serverDossier.using')} <strong>{config?.activeProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'}</strong> {msg('serverDossier.protocol')} <strong>{active?.model}</strong></p><code>{active?.baseUrl}</code><p>{reuse ? baselineOnly ? msg('serverDossier.onlyTheSavedOverviewAndRuntimesBaselinePreviews') : msg('serverDossier.onlySavedCollectionPreviewsAreSentToThe') : msg('serverDossier.runsBoundedQueriesOnThisServerAndSends')}</p><label className="security-checkbox"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />{reuse ? msg('serverDossier.allowSendingSavedCollectionResultsToTheAi') : msg('serverDossier.allowTheseQueriesAndSendingResultsToThe')}</label><div className="dossier-actions"><button className="credential-secondary" disabled={busy} onClick={() => { setConfirm(false); setAck(false) }}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy || !ack} onClick={() => void action('start')}>{msg('serverDossier.startInvestigation')}</button></div></section>}
    </div>
    <footer className="dossier-footer"><span>{running ? msg('serverDossier.everyQueryIsRecordedInOperationLogs') : report ? msg('serverDossier.savedLocallyManualCorrectionsRetained') : !server.credentialId ? msg('serverDossier.bindServerCredentialsFirst') : active ? msg('serverDossier.usesTheCurrentAiConfigurationInSettings') : msg('serverDossier.saveAiSettingsFirst')}</span>{!running && !confirm && report && (run?.evidence.length ?? 0) >= 2 && <button className="credential-secondary" disabled={busy || !config || !active || !view} title={msg('serverDossier.summarizeTheTwoSavedBaselineItemsOnlyNo')} onClick={() => { setError(''); setReuse(true); setBaselineOnly(true); setConfirm(true); setAck(false) }}>{msg('serverDossier.validateBaselineSummary')}</button>}{!running && !confirm && <button className="credential-primary" disabled={busy || !config || !active || !view || !server.credentialId} onClick={() => { setError(''); setReuse(false); setConfirm(true); setAck(false) }}><Bot size={15} />{report ? msg('serverDossier.investigateAgain') : msg('serverDossier.startInvestigation')}</button>}</footer>
    {editing && view?.report && <DossierEditor serverId={server.id} view={view} onSaved={next => setView(next)} onClose={() => setEditing(false)} />}
    {evidence && <Dialog className="agent-dialog operation-dialog dossier-evidence-dialog" labelledBy="dossier-evidence-title" onDismiss={() => setSelected(null)}><div className="agent-dialog-header"><h2 id="dossier-evidence-title">{evidence.purpose}</h2><button className="icon-button" aria-label={msg('serverDossier.closeEvidence')} onClick={() => setSelected(null)}><X size={18} /></button></div><p>{evidence.query} {evidence.target} · {evidence.state} {msg('serverDossier.exitCode')} {evidence.exitCode ?? msg('dossierEditor.unknown')}</p><small>{msg('serverDossier.operationRecord')} {evidence.operationId}</small>{evidence.truncated && <p>{msg('serverDossier.onlyABoundedPreviewWasSavedOutputTruncated')}</p>}<pre className="dossier-evidence-text">{evidence.preview || msg('serverDossier.noOutput')}</pre></Dialog>}
  </Dialog>
}
function EvidenceRow({ evidence: e, onClick }: { evidence: InvestigationEvidence; onClick: () => void }) { return <button className="dossier-evidence-row" onClick={onClick}><span>{e.purpose}</span><small>{e.query} · {e.state}{e.truncated ? msg('serverDossier.truncated') : ''}</small></button> }
