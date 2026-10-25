import { msg, getLocale, errorText } from '../../../shared/i18n'
import { useEffect, useState } from 'react'
import { Check, Copy, Pencil, Trash2 } from 'lucide-react'
import type { AccessProfile, ProfilePage, ProfileQuery, ServerRecord } from '../../../shared/contracts'
const api = window.hostharbor
const statuses = { get active() { return msg('profileList.active') }, get expired() { return msg('approvalSettings.expired') }, get revoked() { return msg('profileList.revoked') }, get deleted() { return msg('profileList.deleted') } }
function status(p: AccessProfile) { return p.deletedAt ? 'deleted' : p.revokedAt ? 'revoked' : p.expiresAt !== null && p.expiresAt <= Date.now() ? 'expired' : 'active' }
export function ProfileList({ servers, revision, busy, copied, onEdit, onCopy, onRevoke, onDelete }: { servers: ServerRecord[]; revision: number; busy: boolean; copied: string | null; onEdit: (p: AccessProfile) => void; onCopy: (p: AccessProfile) => void; onRevoke: (p: AccessProfile) => void; onDelete: (p: AccessProfile) => void }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<ProfileQuery['status']>('active'), [offset, setOffset] = useState(0), [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState<ProfilePage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  useEffect(() => {
    let disposed = false, polling = false
    setPage(null); setLoading(true); setError('')
    async function refresh() {
      if (polling) return
      polling = true
      try {
        const result = await api.queryProfiles({ query, status: filter, offset, pageSize })
        if (disposed) return
        if (!result.ok) throw new Error(errorText(result.error))
        setPage(result.value); setError('')
        if (result.value.offset !== offset) setOffset(result.value.offset)
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : msg('profileList.cannotLoadAccessProfiles')) }
      finally { polling = false; if (!disposed) setLoading(false) }
    }
    const debounce = window.setTimeout(() => void refresh(), 180), timer = window.setInterval(() => void refresh(), 3000)
    return () => { disposed = true; clearTimeout(debounce); clearInterval(timer) }
  }, [query, filter, offset, pageSize, revision])
  return <div className="profile-list-workspace">
    <div className="profile-list-filters"><input aria-label={msg('profileList.searchAccessOrServer')} placeholder={msg('profileList.searchAccessNameServerOrAddress')} maxLength={100} value={query} onChange={e => { setQuery(e.target.value); setOffset(0) }} onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setOffset(0) } }} /><select aria-label={msg('profileList.accessStatus')} value={filter} onChange={e => { setFilter(e.target.value as ProfileQuery['status']); setOffset(0) }}><option value="all">{msg('approvalSettings.all')}</option><option value="active">{msg('profileList.active')}</option><option value="expired">{msg('approvalSettings.expired')}</option><option value="revoked">{msg('profileList.revoked')}</option><option value="deleted">{msg('profileList.deleted')}</option></select></div>
    {error && <p role="alert" className="dialog-error">{error}</p>}
    <div className={`profile-table-scroll${!page?.profiles.length ? ' is-empty' : ''}`}><table className="profile-table" aria-label={msg('profileList.agentAccessList')}><thead><tr><th>{msg('profileList.accessName')}</th><th>{msg('profileList.accessibleServers')}</th><th>{msg('operationList.status')}</th><th>{msg('agentWorkspace.validity')}</th><th>{msg('credentialsPage.actions')}</th></tr></thead><tbody>{page?.profiles.map(p => { const state = status(p), names = p.serverIds.map(id => servers.find(s => s.id === id)?.name ?? msg('agentWorkspace.deletedServer')).join(msg('common.listSeparator')); return <tr key={p.id}><td title={p.name}><strong>{p.name}</strong></td><td title={names}>{names}</td><td><span className={`profile-status profile-status-${state}`}>{statuses[state]}</span></td><td title={p.expiresAt === null ? msg('profileList.validPermanently') : new Date(p.expiresAt).toLocaleString(getLocale())}>{p.expiresAt === null ? msg('agentWorkspace.permanent') : new Date(p.expiresAt).toLocaleDateString(getLocale())}</td><td><div className="profile-list-actions">{!p.deletedAt && !p.revokedAt && <button className="text-button" disabled={busy} onClick={() => onEdit(p)}><Pencil size={13} />{msg('approvalSettings.edit')}</button>}{state === 'active' && <><button className="text-button" disabled={busy} onClick={() => onCopy(p)}>{copied === p.id ? <Check size={13} /> : <Copy size={13} />}{copied === p.id ? msg('agentWorkspace.copied') : msg('profileList.copyConfiguration')}</button><button className="text-button" disabled={busy} onClick={() => onRevoke(p)}>{msg('agentWorkspace.revoke')}</button></>}{!p.deletedAt ? <button className="text-button profile-delete" disabled={busy} onClick={() => onDelete(p)}><Trash2 size={13} />{msg('agentWorkspace.delete')}</button> : <span className="profile-deleted-time" title={new Date(p.deletedAt).toLocaleString(getLocale())}>{new Date(p.deletedAt).toLocaleDateString(getLocale())} {msg('agentWorkspace.delete')}</span>}</div></td></tr> })}</tbody></table>{!page?.profiles.length && <div className="profile-table-empty" role="status">{loading ? msg('profileList.loadingAccessProfiles') : error ? msg('profileList.accessLoadFailed') : query || filter !== 'all' ? msg('profileList.noMatchingAccessProfiles') : msg('profileList.noAccessYetUseCreateAccessAbove')}</div>}</div>
    <footer className="profile-pagination"><span role="status">{msg('profileList.total')} {page?.total ?? 0} {msg('operationList.records')}</span><div><select aria-label={msg('profileList.accessPageSize')} value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setOffset(0) }}>{[20, 50, 100].map(n => <option key={n} value={n}>{n} {msg('profileList.perPage')}</option>)}</select><button className="credential-secondary" disabled={loading || !page || offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>{msg('operationList.previous')}</button><span>{Math.floor(offset / pageSize) + 1} / {Math.max(1, Math.ceil((page?.total ?? 0) / pageSize))}</span><button className="credential-secondary" disabled={loading || !page || offset + pageSize >= page.total} onClick={() => setOffset(offset + pageSize)}>{msg('operationList.next')}</button></div></footer>
  </div>
}
