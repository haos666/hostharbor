import { msg, getLocale, errorText } from '../../../shared/i18n'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, X, FileText } from 'lucide-react'
import type { ApplicationInput, ApplicationRecord, LogSource } from '../../../shared/application'
import type { ServerDossier } from '../../../shared/dossier'
import { Dialog } from './Dialog'
const api = window.hostharbor
const empty = (serverId: string, serverRevision: number): ApplicationInput => ({ serverId, serverRevision, revision: 0, name: '', aliases: [], description: '', environment: '', deploymentPath: '', runtime: 'unknown', runtimeTarget: '', ports: [], logSources: [] })
const sourceLabels = { get file() { return msg('applicationsPanel.file') }, get journal() { return msg('applicationsPanel.systemdLogs') }, get docker() { return msg('applicationsPanel.dockerLogs') } }
export function ApplicationsPanel({ serverId, serverRevision, report }: { serverId: string; serverRevision: number; report: ServerDossier | null }) {
  const [items, setItems] = useState<ApplicationRecord[]>([]), [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<ApplicationInput | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'discard' | ApplicationRecord | null>(null)
  const initial = useRef(''), alive = useRef(true)
  useEffect(() => {
    alive.current = true
    void api.listApplications(serverId).then(r => { if (!alive.current) return; if (r.ok) { setItems(r.value); setLoaded(true) } else setError(errorText(r.error)) })
    return () => { alive.current = false }
  }, [serverId])
  function edit(record?: ApplicationRecord) {
    const input: ApplicationInput = record ? { serverId, serverRevision, id: record.id, revision: record.revision, ports: record.ports ?? [], name: record.name, aliases: record.aliases, description: record.description, environment: record.environment, deploymentPath: record.deploymentPath, runtime: record.runtime, runtimeTarget: record.runtimeTarget, logSources: record.logSources } : empty(serverId, serverRevision)
    initial.current = JSON.stringify(input); setEditing(input); setError('')
  }
  function dismiss() { if (busy) return; if (JSON.stringify(editing) !== initial.current) setConfirm('discard'); else setEditing(null) }
  function patch(update: Partial<ApplicationInput>) { setEditing(current => current ? { ...current, ...update } : current) }
  function sourcePatch(id: string, update: Partial<LogSource>) { if (editing) patch({ logSources: editing.logSources.map(s => s.id === id ? { ...s, ...update } as LogSource : s) }) }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || busy) return; setBusy(true); setError('')
    try {
      const result = await api.saveApplication({ ...editing, aliases: [...new Set(editing.aliases.map(a => a.trim()).filter(Boolean))], ports: [...new Set((editing.ports ?? []).map(p => p.trim()).filter(Boolean))] })
      if (!alive.current) return
      if (!result.ok) { setError(errorText(result.error)); return }
      setItems(current => [...current.filter(a => a.id !== result.value.id), result.value]); setEditing(null)
    } catch { if (alive.current) setError(msg('applicationsPanel.operationIncompleteReopenTheDossierAndRetry')) } finally { if (alive.current) setBusy(false) }
  }
  async function remove(record: ApplicationRecord) {
    setBusy(true); setError('')
    try {
      const result = await api.deleteApplication({ serverId, id: record.id, revision: record.revision })
      if (!alive.current) return
      if (!result.ok) { setConfirm(null); setError(errorText(result.error)); return }
      setItems(current => current.filter(a => a.id !== record.id)); setConfirm(null)
    } catch { if (alive.current) setError(msg('applicationsPanel.operationIncompleteReopenTheDossierAndRetry')) } finally { if (alive.current) setBusy(false) }
  }
  function importCandidate(value: string) {
    if (value === '') { patch({ discovery: undefined }); return }; if (!report) return
    const index = Number(value), app = report.content.applications[index]
    if (!app || !editing) return
    patch({ name: app.name, ports: app.ports, deploymentPath: app.directories.find(d => ['application', 'working'].includes(d.kind) && d.path.startsWith('/'))?.path ?? '', discovery: { runId: report.runId, index } })
  }
  return <section className="dossier-section application-panel">
    <div className="application-heading"><div><h3><FileText size={16} />{msg('applicationsPanel.applicationContext')} <span>{items.length}</span></h3><p>{msg('applicationsPanel.maintainApplicationAndLogLocationsForAgentsAi')}</p></div><button className="credential-secondary" disabled={!loaded || busy} onClick={() => edit()}><Plus size={15} />{msg('applicationsPanel.addApplication')}</button></div>
    {!editing && error && <p className="drawer-error" role="alert">{error}</p>}
    {loaded && !items.length && <p className="application-empty">{msg('applicationsPanel.addNamesAliasesAndLogSourcesForDirect')}</p>}
    <div className="application-list">{items.map(a => <article key={a.id}>
      <div className="application-heading"><div><strong>{a.name}</strong>{a.environment && <small>{a.environment}</small>}</div><div className="application-buttons"><button className="icon-button" aria-label={msg('applicationsPanel.editValue', { value0: a.name })} onClick={() => edit(a)}><Pencil size={15} /></button><button className="icon-button" aria-label={msg('applicationsPanel.deleteValue', { value0: a.name })} onClick={() => { setError(''); setConfirm(a) }}><Trash2 size={15} /></button></div></div>
      {a.aliases.length > 0 && <p>{msg('applicationsPanel.aliases')}{a.aliases.join(msg('common.listSeparator'))}</p>}{a.description && <p>{a.description}</p>}
      <dl><dt>{msg('applicationsPanel.deployment')}</dt><dd>{a.deploymentPath || msg('applicationsPanel.unconfirmed')}</dd><dt>{msg('applicationsPanel.runtime')}</dt><dd>{a.runtime === 'unknown' ? msg('applicationsPanel.unconfirmed') : `${a.runtime} · ${a.runtimeTarget || msg('applicationsPanel.identifierMissing')}`}</dd><dt>{msg('applicationsPanel.port')}</dt><dd>{a.ports?.join(msg('common.listSeparator')) || msg('applicationsPanel.unconfirmed')}</dd><dt>{msg('applicationsPanel.logs')}</dt><dd>{a.logSources.length ? a.logSources.map(s => <div key={s.id}>{s.name} · {sourceLabels[s.kind]} <code>{s.target}</code></div>) : msg('applicationsPanel.notConfigured')}</dd></dl>
      <small>{a.connectionChanged ? msg('applicationsPanel.connectionChangedVerifyAndSaveAgain') : ''}{msg('applicationsPanel.manuallyConfirmedAt')} {new Date(a.confirmedAt).toLocaleString(getLocale())} {msg('applicationsPanel.queryToVerifyTheCurrentRuntimeState')}{a.discovery && msg('applicationsPanel.discoveryEvidenceValue', { value0: new Date(a.discovery.collectedAt).toLocaleString(getLocale()) })}</small>
    </article>)}</div>
    {editing && <Dialog className="application-dialog" labelledBy="application-title" onDismiss={dismiss}>
      <header className="application-heading"><h2 id="application-title">{editing.id ? msg('applicationsPanel.editApplicationContext') : msg('applicationsPanel.addApplicationContext')}</h2><button className="icon-button" aria-label={msg('applicationsPanel.closeApplicationEditor')} disabled={busy} onClick={dismiss}><X size={18} /></button></header>
      <form onSubmit={e => void save(e)}>
        <div className="application-form-body"><fieldset disabled={busy}>
          {!editing.id && report && <label>{msg('applicationsPanel.importFromDossier')}<select defaultValue="" onChange={e => importCandidate(e.target.value)}><option value="">{msg('applicationsPanel.enterManually')}</option>{report.content.applications.map((a, i) => <option key={i} value={i}>{a.name}</option>)}</select><small>{msg('applicationsPanel.onlyNamesPortsAndHostDeploymentDirectoriesAre')}</small></label>}
          <div className="application-form-grid"><label>{msg('applicationsPanel.applicationName')}<input required maxLength={200} data-initial-focus value={editing.name} onChange={e => patch({ name: e.target.value })} /></label><label>{msg('applicationsPanel.environment')}<input maxLength={1200} placeholder={msg('applicationsPanel.environment2')} value={editing.environment} onChange={e => patch({ environment: e.target.value })} /></label></div>
          <label>{msg('applicationsPanel.aliases2')}<input maxLength={4000} placeholder={msg('applicationsPanel.applicationAliasAnotherAlias')} value={editing.aliases.join(',')} onChange={e => patch({ aliases: e.target.value.split(/[,，]/) })} /></label>
          <label>{msg('applicationsPanel.purpose')}<textarea maxLength={1200} rows={2} placeholder={msg('applicationsPanel.describeTheApplicationPurposeForAgents')} value={editing.description} onChange={e => patch({ description: e.target.value })} /></label>
          <label>{msg('applicationsPanel.listeningPorts')}<input maxLength={4000} placeholder={msg('applicationsPanel.portTcpAnotherPortTcp')} value={(editing.ports ?? []).join(',')} onChange={e => patch({ ports: e.target.value.split(/[,，]/) })} /></label>
          <label>{msg('applicationsPanel.hostDeploymentDirectory')}<input maxLength={1024} placeholder={msg('applicationsPanel.deploymentDirectoryOptional')} value={editing.deploymentPath} onChange={e => patch({ deploymentPath: e.target.value })} /></label>
          <div className="application-form-grid"><label>{msg('applicationsPanel.runtimeType')}<select value={editing.runtime} onChange={e => patch({ runtime: e.target.value as ApplicationInput['runtime'] })}><option value="unknown">{msg('applicationsPanel.unconfirmed')}</option><option value="systemd">systemd</option><option value="docker">Docker</option><option value="process">{msg('applicationsPanel.process')}</option></select></label><label>{msg('applicationsPanel.runtimeIdentifier')}<input maxLength={1200} placeholder={msg('applicationsPanel.serviceNameContainerNameProcessName')} value={editing.runtimeTarget} onChange={e => patch({ runtimeTarget: e.target.value })} /></label></div>
          <div className="application-heading"><h3>{msg('applicationsPanel.logSources')}</h3><button type="button" className="credential-secondary" disabled={editing.logSources.length >= 10} onClick={() => patch({ logSources: [...editing.logSources, { id: crypto.randomUUID(), name: '', kind: 'file', target: '', timezone: '' }] })}><Plus size={14} />{msg('applicationsPanel.addSource')}</button></div>
          {editing.logSources.map(s => <section className="application-source" key={s.id}><div className="application-form-grid"><label>{msg('agentWorkspace.name')}<input required maxLength={200} placeholder={msg('applicationsPanel.logSourceName')} value={s.name} onChange={e => sourcePatch(s.id, { name: e.target.value })} /></label><label>{msg('applicationsPanel.source')}<select value={s.kind} onChange={e => sourcePatch(s.id, { kind: e.target.value as LogSource['kind'], target: '' })}><option value="file">{msg('applicationsPanel.file')}</option><option value="journal">systemd journal</option><option value="docker">Docker stdout/stderr</option></select></label></div><label>{s.kind === 'file' ? msg('applicationsPanel.absoluteFilePathNoWildcards') : s.kind === 'journal' ? msg('applicationsPanel.fullUnitName') : msg('applicationsPanel.containerNameOrId')}<input required maxLength={1024} placeholder={s.kind === 'file' ? '/<application-directory>/logs/<file-name>' : s.kind === 'journal' ? '<unit-name>.service' : '<container-name>'} value={s.target} onChange={e => sourcePatch(s.id, { target: e.target.value })} /></label><div className="application-form-grid"><label>{msg('applicationsPanel.logTimezoneTimeNotes')}<input maxLength={1200} placeholder={msg('applicationsPanel.ianaTimezoneLeaveBlankIfUnknown')} value={s.timezone} onChange={e => sourcePatch(s.id, { timezone: e.target.value })} /></label><button className="credential-secondary" type="button" onClick={() => patch({ logSources: editing.logSources.filter(item => item.id !== s.id) })}>{msg('applicationsPanel.removeThisSource')}</button></div><small>{s.kind === 'file' ? msg('applicationsPanel.filesUseTailSamplingOnlyWithoutAutomaticRotation') : msg('applicationsPanel.queryTheSpecifiedTimeWindowSubjectToEntry')}</small></section>)}
          <p className="dossier-footnote">{msg('applicationsPanel.enterLocationDetailsWithoutPasswordsTokensOrConfiguration')}</p>
          {error && <p className="drawer-error" role="alert">{error}</p>}
        </fieldset></div>
        <footer className="application-form-footer"><button type="button" className="credential-secondary" disabled={busy} onClick={dismiss}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy}>{busy ? msg('applicationsPanel.saving') : msg('applicationsPanel.saveDossier')}</button></footer>
      </form>
    </Dialog>}
    {confirm && <Dialog className="agent-dialog" labelledBy="application-confirm-title" onDismiss={() => { if (!busy) setConfirm(null) }}><h2 id="application-confirm-title">{confirm === 'discard' ? msg('agentWorkspace.discardUnsavedChanges') : msg('applicationsPanel.deleteTheDossierForValue', { value0: confirm.name })}</h2><p>{confirm === 'discard' ? msg('applicationsPanel.changesHaveNotBeenSaved') : msg('applicationsPanel.deleteLocalApplicationContextAndLogSourcesOnly')}</p><div className="application-form-footer"><button className="credential-secondary" disabled={busy} onClick={() => setConfirm(null)}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy} onClick={() => { if (confirm === 'discard') { setConfirm(null); setEditing(null); setError('') } else void remove(confirm) }}>{confirm === 'discard' ? msg('agentWorkspace.discardChanges') : msg('applicationsPanel.deleteDossier')}</button></div></Dialog>}
  </section>
}
