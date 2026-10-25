import { msg, getLocale, errorText } from '../../../shared/i18n'
import { operationApproval } from '../catalog'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import type { HistoryPage, HistoryQuery, Operation, OperationState } from '../../../shared/contracts'
import { isTerminalOperation } from '../../../shared/operation-states'
export const operationStateLabels: Record<OperationState, string> = { get awaiting_approval() { return msg('historyPage.awaitingApproval') }, get queued() { return msg('historyPage.queued') }, get connecting() { return msg('historyPage.connecting') }, get dispatching() { return msg('historyPage.dispatching') }, get running() { return msg('historyPage.running') }, get succeeded() { return msg('historyPage.completed') }, get failed() { return msg('historyPage.executionFailed') }, get denied() { return msg('historyPage.denied') }, get interrupted() { return msg('historyPage.notDispatchedInterrupted') }, get unknown() { return msg('historyPage.outcomeUnknown') }, get expired() { return msg('historyPage.approvalExpired') } }
const blank = { search: '', serverId: '', profileId: '', state: '', since: '', until: '' }
export function OperationList({ onSelect, revision, history = false }: { onSelect: (o: Operation) => void; revision: number; history?: boolean }) {
  const [draft, setDraft] = useState(blank), [query, setQuery] = useState<HistoryQuery>({ offset: 0, pageSize: 20, stateGroup: history ? 'terminal' : 'active' })
  const [page, setPage] = useState<HistoryPage | null>(null), [options, setOptions] = useState<NonNullable<HistoryPage['options']>>({ servers: [], profiles: [] })
  const [error, setError] = useState(''), [validation, setValidation] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0), [jump, setJump] = useState('')
  const [expanded, setExpanded] = useState(false)
  const epoch = useRef(0)
  useEffect(() => {
    const current = ++epoch.current; let pending = false, first = true
    setPage(null); setBusy(true); setJump('')
    const refresh = async () => {
      if (pending) return; pending = true
      try {
        const result = await window.hostharbor.queryHistory({ ...query, stateGroup: history ? 'terminal' : 'active', includeOptions: true })
        if (current !== epoch.current) return
        if (!result.ok) throw new Error(errorText(result.error))
        const next = result.value, size = query.pageSize ?? 20, lastOffset = Math.max(0, Math.floor((next.total - 1) / size) * size)
        if ((query.offset ?? 0) > lastOffset) { setQuery(q => ({ ...q, offset: lastOffset })); return }
        setPage(next); if (next.options) setOptions(next.options); setError('')
      } catch (e) { if (current === epoch.current) { setError(e instanceof Error ? e.message : msg('operationList.cannotQueryOperations')); if (first) setPage(null) } }
      finally { if (current === epoch.current) setBusy(false); first = false; pending = false }
    }
    void refresh(); const timer = window.setInterval(() => void refresh(), 3000)
    return () => { epoch.current++; window.clearInterval(timer) }
  }, [query, reload, revision, history])
  function filter(event: FormEvent) {
    event.preventDefault()
    const since = draft.since ? new Date(draft.since).getTime() : undefined, until = draft.until ? new Date(draft.until).getTime() : undefined
    if ((since !== undefined && !Number.isFinite(since)) || (until !== undefined && !Number.isFinite(until)) || (since !== undefined && until !== undefined && since > until)) { setValidation(msg('operationList.enterValidTimesStartMustNotBeAfter')); return }
    setValidation(''); setQuery({ offset: 0, pageSize: query.pageSize, search: draft.search.trim() || undefined, serverId: draft.serverId || undefined, profileId: draft.profileId || undefined, stateGroup: history ? 'terminal' : 'active', state: draft.state as OperationState || undefined, since, until }); setReload(n => n + 1)
  }
  const size = query.pageSize ?? 20, index = Math.floor((query.offset ?? 0) / size) + 1, pages = Math.max(1, Math.ceil((page?.total ?? 0) / size))
  function go(n: number) { if (!Number.isInteger(n) || n < 1 || n > pages) return; setQuery(q => ({ ...q, offset: (n - 1) * size })); setJump('') }
  function reset() { setDraft(blank); setValidation(''); setQuery({ offset: 0, pageSize: size, stateGroup: history ? 'terminal' : 'active' }); setReload(n => n + 1) }
  return <div className="operation-query compact-operation-query history-query">
    <form className="operation-filters" onSubmit={filter}>
      <label className="operation-search">{msg('operationList.keyword')}<input maxLength={200} placeholder={msg('operationList.commandServerOrAccessName')} value={draft.search} onChange={e => setDraft({ ...draft, search: e.target.value })} /></label>
      <label>{msg('approvalSettings.server')}<select value={draft.serverId} onChange={e => setDraft({ ...draft, serverId: e.target.value })}><option value="">{msg('operationList.allServers')}</option>{options.servers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <label hidden={!expanded}>{msg('operationList.accessSource')}<select value={draft.profileId} onChange={e => setDraft({ ...draft, profileId: e.target.value })}><option value="">{msg('operationList.allSources')}</option>{options.profiles.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
      <label>{msg('operationList.status')}<select value={draft.state} onChange={e => setDraft({ ...draft, state: e.target.value })}><option value="">{history ? msg('operationList.allFinished') : msg('operationList.allPending')}</option>{Object.entries(operationStateLabels).filter(([state]) => isTerminalOperation(state as OperationState) === history).map(([state, label]) => <option value={state} key={state}>{label}</option>)}</select></label>
      <label hidden={!expanded}>{msg('operationList.submittedFrom')}<input type="datetime-local" value={draft.since} onChange={e => setDraft({ ...draft, since: e.target.value })} /></label>
      <label hidden={!expanded}>{msg('operationList.submittedUntil')}<input type="datetime-local" value={draft.until} onChange={e => setDraft({ ...draft, until: e.target.value })} /></label>
      <div className="operation-filter-actions"><button type="button" className="credential-secondary" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><SlidersHorizontal size={14} />{expanded ? msg('operationList.fewerFilters') : msg('operationList.moreFilters')}{!expanded && (query.profileId || query.since !== undefined || query.until !== undefined) ? msg('operationList.applied') : ''}</button><button className="credential-primary" disabled={busy}><Search size={14} />{msg('operationList.search')}</button><button type="button" className="credential-secondary" onClick={reset}>{msg('operationList.reset')}</button></div>
    </form>
    {(validation || error) && <p className="drawer-error" role="alert">{validation || error}</p>}
    <div className="operation-list-heading"><span>{busy ? msg('operationList.searching') : page ? msg('operationList.valueOperations', { value0: page.total }) : msg('operationList.operationSearch')}<small>{history ? msg('operationList.finishedUpdatesEvery3Seconds') : msg('operationList.pendingAndRunningUpdatesEvery3Seconds')}</small></span><button className="credential-secondary" disabled={busy} onClick={() => setReload(n => n + 1)}><RefreshCw size={14} />{msg('operationList.refresh')}</button></div>
    <div className={`operation-table-scroll${!page?.operations.length ? ' is-empty' : ''}`} aria-busy={busy}><table className="operation-query-table"><thead><tr><th>{msg('historyPage.submitted')}</th><th>{msg('approvalSettings.server')}</th><th>{msg('operationList.commandSummary')}</th><th>{msg('operationList.status')}</th><th>{msg('common.approval')}</th><th>{history ? msg('operationList.replay') : msg('agentWorkspace.exitCode')}</th><th>{msg('credentialsPage.actions')}</th></tr></thead><tbody>{page?.operations.map(o => <tr key={o.id}><td className="operation-time" title={new Date(o.createdAt).toLocaleString(getLocale())}>{new Date(o.createdAt).toLocaleDateString(getLocale(), { month: '2-digit', day: '2-digit' })} {new Date(o.createdAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })}</td><td className="operation-origin"><strong title={`${o.serverName} · ${o.profileName}`}>{o.serverName}</strong></td><td className="operation-command-cell"><code title={o.input.command}>{o.input.command}</code></td><td><span className={`operation-state state-${o.state}`}>{operationStateLabels[o.state]}</span></td><td className={`operation-approval ${operationApproval(o).automatic ? 'is-automatic' : ''}`} title={o.decision?.reason}>{operationApproval(o).label}</td><td className="operation-exit">{history ? o.replayClearedAt ? msg('historyPage.cleared') : o.outputBytes ? msg('operationList.replayAvailable') : '—' : o.exitCode ?? '—'}</td><td><button className="operation-detail-link" onClick={() => onSelect(o)} aria-label={msg('operationList.viewOperationValue', { value0: o.id })}>{!history && o.state === 'awaiting_approval' ? msg('agentWorkspace.approve') : msg('operationList.details')}</button></td></tr>)}</tbody></table>{!page?.operations.length && <div className="operation-query-empty" role="status">{busy ? msg('operationList.loadingOperations') : error ? msg('operationList.queryFailedRetry') : <><strong>{history ? msg('operationList.noMatchingOperationLogs') : msg('operationList.noPendingOperations')}</strong><span>{history ? msg('operationList.finishedOperationsAppearHere') : msg('operationList.pendingAndRunningOperationsAppearHere')}</span></>}</div>}</div>
    <div className="operation-query-footer"><label>{msg('operationList.perPage')}<select aria-label={msg('operationList.pageSize')} value={size} disabled={busy} onChange={e => setQuery(q => ({ ...q, pageSize: Number(e.target.value) as 20 | 50 | 100, offset: 0 }))}>{[20, 50, 100].map(n => <option value={n} key={n}>{n} {msg('operationList.records')}</option>)}</select></label><span>{page?.total ? `${(query.offset ?? 0) + 1}–${Math.min((query.offset ?? 0) + size, page.total)} / ${page.total}` : msg('operationList.0Records')}</span><nav aria-label={msg('operationList.operationPagination')}><button className="credential-secondary" aria-label={msg('operationList.previous')} disabled={busy || index <= 1 || !page} onClick={() => go(index - 1)}><ChevronLeft size={15} /></button><span>{msg('pagination.pageOf', { page: index, pages })}</span><button className="credential-secondary" aria-label={msg('operationList.next')} disabled={busy || index >= pages || !page} onClick={() => go(index + 1)}><ChevronRight size={15} /></button></nav><form onSubmit={e => { e.preventDefault(); go(Number(jump)) }}><label>{msg('operationList.goTo')}<input aria-label={msg('operationList.targetPage')} type="number" min={1} max={pages} value={jump} onChange={e => setJump(e.target.value)} /></label><button className="credential-secondary" disabled={busy || !page || !jump}>{msg('operationList.go')}</button></form></div>
  </div>
}
