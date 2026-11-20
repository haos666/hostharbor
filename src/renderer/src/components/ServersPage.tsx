import { Toast } from './Toast'
import { ProxyManager } from './ProxyManager'
import { LockedPage } from './LockedPage'
import { PageHeader } from './PageHeader'
import { emptyServerTags, type ServerTags } from '../../../shared/server-tags'
import { ServerTagsEditor, TagChip } from './ServerTagsEditor'
import { msg, errorText } from '../../../shared/i18n'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, Network, Check, LoaderCircle, Tag, KeyRound, Pencil, Plus, Search, Server, ShieldCheck, Trash2, X } from 'lucide-react'
import type { AppStatus, ConnectionTest, CredentialSummary, ServerInput, ServerRecord, ServerRoute, SocksProxy } from '../../../shared/contracts'
import { credentialLabel, credentialTypes } from '../credential-types'
import { ServerFiles } from './ServerFiles'
import { FolderOpen } from 'lucide-react'
import { ServerDossier } from './ServerDossier'
import { Dialog } from './Dialog'
import { UnlockGate } from './SecuritySettings'

const api = window.hostharbor
type Notice = { error: boolean; text: string }
type Challenge = Extract<ConnectionTest, { status: 'host-key-required' }> & { serverId: string; signature: string }
type Feedback = { signature: string; error: boolean; text: string; fingerprint?: string; time: number }
function signature(server: ServerRecord, credentials: CredentialSummary[], servers: ServerRecord[]) {
  const credential = credentials.find((item) => item.id === server.credentialId)
  const jump = server.route.type === 'ssh-jump' ? servers.find((item) => item.id === (server.route as Extract<ServerRoute, { type: 'ssh-jump' }>).serverId) : undefined
  const transitCredential = jump?.credentialId ?? (server.route.type === 'socks5' && server.route.authentication.type === 'password' ? server.route.authentication.credentialId : null)
  return `${server.id}:${server.revision}:${credential?.id ?? '-'}:${credential?.revision ?? '-'}:${jump?.revision ?? '-'}:${credentials.find((item) => item.id === transitCredential)?.revision ?? '-'}`
}
export function ServersPage({ status, servers, credentials, onRefresh, onSetup, message, onDismissMessage }: {
  status: AppStatus | null; servers: ServerRecord[]; credentials: CredentialSummary[]
  onRefresh: () => Promise<void>; onSetup: () => void; message: Notice | null; onDismissMessage: () => void
}) {
  const [tags,setTags]=useState<ServerTags>(emptyServerTags)
  const [proxies,setProxies]=useState<SocksProxy[]>([]),[proxyManager,setProxyManager]=useState(false),[proxiesLoading,setProxiesLoading]=useState(true),[proxyError,setProxyError]=useState('')
  const [tagFilter,setTagFilter]=useState('all'),[tagEditor,setTagEditor]=useState<string|null>(null),[tagsLoading,setTagsLoading]=useState(true),[tagsError,setTagsError]=useState('')
  const [filesId, setFilesId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<ServerRecord | 'new' | null>(null)
  const [dossierId, setDossierId] = useState<string | null>(null)
  const [binding, setBinding] = useState(false)
  const [deleting, setDeleting] = useState<ServerRecord | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const current = useRef({ status, servers, credentials })
  current.current = { status, servers, credentials }
  const epoch = useRef(0)
  const unlocked = status?.vault === 'unlocked'
  const search = query.trim().toLocaleLowerCase()
  // Polling replaces server objects every two seconds; tag membership only needs
  // refreshing when the set of server IDs changes, not on each new array.
  const tagServerIds = JSON.stringify(servers.map(server => server.id).sort())
  const visible = servers.filter((server) => (tagFilter==='all'||(tagFilter==='untagged'?!(tags.assignments[server.id]?.length):tags.assignments[server.id]?.includes(tagFilter))) && [server.name, server.host, server.username].some((value) => value.toLocaleLowerCase().includes(search)))
  useEffect(()=>{let active=true;if(!unlocked){setTags(emptyServerTags());setTagFilter('all');setTagEditor(null);return}setTagsLoading(true);setTagsError('');void api.getServerTags().then(result=>{if(active){if(result.ok)setTags(result.value);else setTagsError(errorText(result.error))}}).catch(()=>{if(active)setTagsError(msg('serversPage.saveIncompleteRetry'))}).finally(()=>{if(active)setTagsLoading(false)});return()=>{active=false}},[unlocked,status?.lockRevision,tagServerIds])
  useEffect(()=>{let active=true;if(!unlocked){setProxies([]);setProxyManager(false);return}setProxiesLoading(true);setProxyError('');void api.listProxies().then(async result=>{if(!active)return;if(result.ok){setProxies(result.value);await onRefresh()}else setProxyError(errorText(result.error))}).catch(()=>{if(active)setProxyError(msg('serversPage.saveIncompleteRetry'))}).finally(()=>{if(active)setProxiesLoading(false)});return()=>{active=false}},[unlocked,status?.lockRevision])
  useEffect(()=>{if(tagFilter!=='all'&&tagFilter!=='untagged'&&!tags.tags.some(t=>t.id===tagFilter))setTagFilter('all')},[tags,tagFilter])
  useEffect(() => () => { epoch.current++ }, [])
  useEffect(() => {
    if (!unlocked) { epoch.current++; setQuery(''); setDossierId(null); setFilesId(null); setEditor(null); setDeleting(null); setChallenge(null); setFeedback({}); setNotice(null); setPending(null) }
  }, [unlocked, status?.lockRevision])
  function valid(id: string, expected: string, generation: number) {
    const view = current.current
    const server = view.servers.find((item) => item.id === id)
    return epoch.current === generation && view.status?.vault === 'unlocked' && !!server && signature(server, view.credentials, view.servers) === expected
  }
  async function test(server: ServerRecord, trusted?: Challenge) {
    if (pending) return
    const expected = signature(server, credentials, servers)
    const generation = epoch.current
    setPending(server.id); setNotice(null); onDismissMessage()
    setFeedback((old) => { const next = { ...old }; delete next[server.id]; return next })
    try {
      if (trusted) {
        if (!valid(server.id, trusted.signature, generation)) return
        const result = await api.trustHost(trusted.challengeId)
        if (!valid(server.id, expected, generation)) return
        if (!result.ok) { setChallenge(null); setFeedback((old) => ({ ...old, [server.id]: { signature: expected, error: true, text: errorText(result.error), time: Date.now() } })); return }
        setChallenge(null)
      }
      if (!valid(server.id, expected, generation)) return
      const result = await api.testConnection(server.id)
      if (!valid(server.id, expected, generation)) return
      if (!result.ok) setFeedback((old) => ({ ...old, [server.id]: { signature: expected, error: true, text: errorText(result.error), time: Date.now() } }))
      else if (result.value.status === 'host-key-required') setChallenge({ ...result.value, serverId: server.id, signature: expected })
      else setFeedback((old) => ({ ...old, [server.id]: { signature: expected, error: false, text: msg('serversPage.authenticatedValueMs', { value0: result.value.status === 'connected' ? result.value.durationMs : 0 }), fingerprint: result.value.fingerprint, time: Date.now() } }))
    } catch {
      if (valid(server.id, expected, generation)) setFeedback((old) => ({ ...old, [server.id]: { signature: expected, error: true, text: msg('serversPage.connectionTestIncompleteRetry'), time: Date.now() } }))
    } finally { if (epoch.current === generation) setPending(null) }
  }
  function edit(server: ServerRecord, bind = false) { if(proxiesLoading||proxyError)return; setBinding(bind); setEditor(server); setNotice(null); onDismissMessage() }
  async function saved(server: ServerRecord) {
    setEditor(null); setQuery(''); setTagFilter('all'); onDismissMessage(); setNotice({ error: false, text: server.credentialId ? msg('serversPage.serverSaved') : msg('serversPage.serverSavedBindCredentialsToTestTheConnection') })
    setFeedback((old) => { const next = { ...old }; delete next[server.id]; return next })
    setChallenge(null)
    try { await onRefresh() } catch { setNotice({ error: true, text: msg('serversPage.serverSavedListRefreshFailed') }) }
  }
  async function remove() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    try {
      const result = await api.deleteServer(deleting.id)
      if (!current.current.status || current.current.status.vault !== 'unlocked') return
      if (!result.ok) { setNotice({ error: true, text: errorText(result.error) }); return }
      setNotice({ error: false, text: msg('serversPage.serverDeleted') }); onDismissMessage()
      try { await onRefresh() } catch { setNotice({ error: true, text: msg('serversPage.serverDeletedListRefreshFailed') }) }
    } catch { setNotice({ error: true, text: msg('serversPage.deletionIncompleteRetry') }) }
    finally { setDeleteBusy(false); setDeleting(null) }
  }
  const displayed = notice ?? message
  const target = challenge ? servers.find((server) => server.id === challenge.serverId && signature(server, credentials, servers) === challenge.signature) : null
  if (!unlocked) return <LockedPage label={msg('credentialsPage.connectionManagement')} title={msg('navigation.servers')} status={status} onRefresh={onRefresh} onSetup={onSetup}/>
  return <section className="servers-page">
    <PageHeader label={msg('credentialsPage.connectionManagement')} title={msg('navigation.servers')} count={unlocked ? servers.length : undefined} actions={unlocked && <div className="server-header-actions"><button className="credential-secondary" disabled={proxiesLoading||!!proxyError} onClick={()=>setProxyManager(true)}><Network size={16}/>{msg('proxies.manage')}</button><button className="credential-secondary server-tags-manage" disabled={tagsLoading||!!tagsError} onClick={()=>setTagEditor('manage')}><Tag size={16}/>{msg(tagsLoading?'tags.loading':'tags.manage')}</button><button className="credential-primary" disabled={proxiesLoading||!!proxyError} onClick={() => { setBinding(false); setEditor('new') }}><Plus size={16} />{msg('serversPage.addServer')}</button></div>}/>
    {proxyError&&<p className="drawer-error" role="alert">{proxyError}</p>}
    {displayed&&<Toast message={displayed.text} error={displayed.error} onDismiss={()=>{setNotice(null);onDismissMessage()}}/>}
    {!unlocked ? <UnlockGate status={status} onRefresh={onRefresh} onSetup={onSetup} /> : <>
      <div className="credentials-controls"><div className="credential-tabs server-tag-tabs" role="group" aria-label={msg('tags.quickFilters')}><button aria-pressed={tagFilter==='all'} onClick={()=>setTagFilter('all')}>{msg('approvalSettings.all')}</button>{tags.tags.filter(tag=>tag.pinned).map(tag=><button key={tag.id} title={tag.name} aria-pressed={tagFilter===tag.id} onClick={()=>setTagFilter(tag.id)}><i style={{backgroundColor:tag.color}} aria-hidden="true"/><span>{tag.name}</span></button>)}</div><div className="server-list-tools"><div className="server-tag-toolbar"><label><select aria-label={msg('tags.title')} value={tagFilter} disabled={tagsLoading||!!tagsError} onChange={event=>setTagFilter(event.target.value)}><option value="all">{msg('tags.all')}</option><option value="untagged">{msg('tags.none')}</option>{tags.tags.map(tag=><option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>{tagsError&&<span role="alert" className="test-failed">{tagsError}</span>}</div><div className="credential-search"><Search size={16} /><input aria-label={msg('serversPage.searchServers')} placeholder={msg('serversPage.searchNameAddressOrAccount')} value={query} onKeyDown={event => { if (event.key === 'Escape') setQuery('') }} onChange={(event) => setQuery(event.target.value)} />{query && <button aria-label={msg('credentialsPage.clearSearch')} onClick={() => setQuery('')}><X size={14} /></button>}</div></div></div>
      <div className="credentials-surface">
        {visible.length ? <div className="server-table" role="table" aria-label={msg('serversPage.serverList')}><div className="server-table-head" role="row"><span role="columnheader">{msg('approvalSettings.server')}</span><span role="columnheader">{msg('serversPage.accountCredential')}</span><span role="columnheader">{msg('tags.title')}</span><span role="columnheader" className="row-actions-heading">{msg('credentialsPage.actions')}</span></div>{visible.map((server) => {
          const credential = credentials.find((item) => item.id === server.credentialId)
          const result = feedback[server.id]?.signature === signature(server, credentials, servers) ? feedback[server.id] : null
          return <div className="server-record" key={server.id}><div className="server-row" role="row">
            <div className="credential-name-cell" role="cell"><span className="credential-kind-icon"><Server size={18} /></span><div className="server-identity"><button className="credential-name" title={server.name} onClick={() => edit(server)}>{server.name}</button><small>{server.host.includes(':') ? `[${server.host}]` : server.host}:{server.port}</small>{server.route.type !== 'direct' && <small className="server-route-label">{server.route.type === 'ssh-jump' ? msg('serversPage.viaSshValue', { value0: servers.find((item) => item.id === (server.route as Extract<ServerRoute, { type: 'ssh-jump' }>).serverId)?.name ?? msg('serversPage.jumpHostUnavailable') }) : `SOCKS5 · ${server.route.host}:${server.route.port}`}</small>}</div></div>
            <div role="cell" className="server-account"><span title={server.username}>{server.username}</span>{credential ? <small><KeyRound size={12} />{credential.name}<span className="server-credential-kind">{credentialLabel(credential.kind)}</span></small> : <small className="unbound-label">{msg('serversPage.noCredentialsBound')}</small>}</div>
            <div role="cell" className="server-tags-cell"><button className="server-tags-trigger" disabled={tagsLoading||!!tagsError} aria-label={msg('tags.addForServer',{name:server.name})} title={(tags.assignments[server.id]??[]).map(id=>tags.tags.find(t=>t.id===id)?.name).join(', ')} onClick={()=>setTagEditor(server.id)}>{(tags.assignments[server.id]??[]).length?<>{(tags.assignments[server.id]??[]).slice(0,2).map(id=>tags.tags.find(t=>t.id===id)).filter((t):t is NonNullable<typeof t>=>!!t).map(tag=><TagChip key={tag.id} tag={tag}/>)}{(tags.assignments[server.id]?.length??0)>2&&<span className="tag-unassigned">+{tags.assignments[server.id].length-2}</span>}</>:<span className="tag-unassigned"><Plus size={13}/>{msg('tags.none')}</span>}</button></div>
            <div role="cell" className="server-row-actions"><button className="icon-button" aria-label={msg('serversPage.filesForValue', { value0: server.name })} title={msg('serversPage.fileTransfer')} disabled={!server.credentialId} onClick={() => setFilesId(server.id)}><FolderOpen size={16} /></button><button className="icon-button server-ai-button" aria-label={msg('serversPage.aiInvestigationForValue', { value0: server.name })} title={msg('serversPage.aiServerDossier')} onClick={() => setDossierId(server.id)}><Bot size={17} /></button><button className="server-connect-button" disabled={pending !== null} onClick={() => credential ? void test(server) : edit(server, true)}>{pending===server.id?<><LoaderCircle size={13} className="dossier-spin"/>{msg('aiSettings.testing')}</>:credential ? msg('serversPage.testConnection') : msg('servers.bindCredentials')}</button><button className="icon-button" aria-label={msg('applicationsPanel.editValue', { value0: server.name })} title={msg('serversPage.editServer')} disabled={pending !== null} onClick={() => edit(server)}><Pencil size={15} /></button><button className="icon-button delete-action" aria-label={msg('applicationsPanel.deleteValue', { value0: server.name })} title={msg('serversPage.deleteServer')} disabled={pending !== null} onClick={() => setDeleting(server)}><Trash2 size={15} /></button></div>
          </div>{result&&<Toast message={[result.text,result.fingerprint,!result.error?msg('serversPage.testEndedNoConnectionIsMaintained'):null].filter(Boolean).join(' · ')} error={result.error} onDismiss={()=>setFeedback(old=>{const next={...old};delete next[server.id];return next})}/>}</div>
        })}</div> : <div className="credential-empty"><div className="empty-key"><Server size={29} strokeWidth={1.4} /></div><h2>{search || tagFilter !== 'all' ? msg('serversPage.noMatchingServers') : msg('serversPage.addYourFirstServer')}</h2><p>{search || tagFilter !== 'all' ? msg('serversPage.tryAnotherNameAddressOrFilter') : msg('serversPage.saveSshConnectionDetailsBindCredentialsAndTest')}</p></div>}
      </div>
    </>}
    {proxyManager&&unlocked&&<ProxyManager initial={proxies} servers={servers} credentials={credentials} onClose={()=>setProxyManager(false)} onChanged={async next=>{setProxies(next);setChallenge(null);setFeedback({});await onRefresh()}}/>}
    {tagEditor && unlocked && (tagEditor==='manage'||servers.some(s=>s.id===tagEditor)) && <ServerTagsEditor initial={tags} server={tagEditor==='manage'?undefined:servers.find(s=>s.id===tagEditor)} onClose={()=>setTagEditor(null)} onSaved={state=>{setTags(state);setTagEditor(null);setNotice({error:false,text:msg('tags.saved')})}}/>}
    {filesId && unlocked && servers.find(s => s.id === filesId) && <ServerFiles server={servers.find(s => s.id === filesId)!} onClose={() => setFilesId(null)} />}
    {dossierId && unlocked && servers.find(s => s.id === dossierId) && <ServerDossier server={servers.find(s => s.id === dossierId)!} onClose={() => setDossierId(null)} />}
    {editor && unlocked && <ServerDrawer proxies={proxies} proxiesLoading={proxiesLoading||!!proxyError} servers={servers} key={editor === 'new' ? 'new' : editor.id} server={editor === 'new' ? null : editor} credentials={credentials} binding={binding} onClose={() => setEditor(null)} onSaved={saved} />}
    {deleting && unlocked && <Dialog className="credential-confirm" labelledBy="server-delete-title" onDismiss={() => { if (!deleteBusy) setDeleting(null) }}><span className="confirm-icon"><Trash2 size={22} /></span><h2 id="server-delete-title">{msg('serversPage.deleteServer2')}</h2><p>{msg('servers.deleteBody', { name: deleting.name })}</p><div className="confirm-actions"><button className="quiet-button" data-initial-focus disabled={deleteBusy} onClick={() => setDeleting(null)}>{msg('agentWorkspace.cancel')}</button><button className="destructive-button" disabled={deleteBusy} onClick={() => void remove()}>{deleteBusy ? msg('credentialsPage.deleting') : msg('serversPage.deleteServer')}</button></div></Dialog>}
    {challenge && target && unlocked && <HostKeyDialog key={challenge.challengeId} challenge={challenge} server={target} busy={pending !== null} onClose={() => setChallenge(null)} onTrust={() => void test(target, challenge)} />}
  </section>
}

function ServerDrawer({ server, servers, credentials, binding, onClose, onSaved, proxies, proxiesLoading }: { proxies:SocksProxy[]; proxiesLoading:boolean; servers: ServerRecord[]; server: ServerRecord | null; credentials: CredentialSummary[]; binding: boolean; onClose: () => void; onSaved: (server: ServerRecord) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const [routeType, setRouteType] = useState<ServerRoute['type']>(server?.route.type ?? 'direct')
  const [proxyId,setProxyId] = useState(server?.route.type==='socks5'?server.route.proxyId??'':'')
  const [sudoEnabled, setSudoEnabled] = useState(server?.elevation?.type === 'sudo')
  const [sudoSource, setSudoSource] = useState<'none' | 'login' | 'credential'>(server?.elevation?.type === 'sudo' ? server.elevation.passwordSource : 'login')
  const [loginCredentialId, setLoginCredentialId] = useState(server?.credentialId ?? '')
  const dirty = useRef(false)
  function dismiss() { if (busy) return; if (dirty.current) setDiscard(true); else onClose() }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const selectedProxy=proxies.find(p=>p.id===proxyId)
    if(routeType==='socks5'&&!selectedProxy){setError(msg('proxies.select'));return}
    const route: ServerRoute = routeType==='direct'?{type:'direct'}:routeType==='ssh-jump'?{type:'ssh-jump',serverId:String(data.get('jumpServerId'))}:{...selectedProxy!.route,proxyId:selectedProxy!.id}
    const elevation: ServerInput['elevation'] = sudoEnabled ? { type: 'sudo', passwordSource: sudoSource, ...(sudoSource === 'credential' ? { credentialId: String(data.get('sudoCredentialId')) } : {}) } : { type: 'none' }
    const input: ServerInput = { elevation, ...(server ? { id: server.id } : {}), route, name: String(data.get('name')).trim(), host: String(data.get('host')).trim(), port: Number(data.get('port')), username: String(data.get('username')).trim(), credentialId: String(data.get('credentialId') || '') || null }
    setBusy(true); setError('')
    try { const result = await api.saveServer(input); if (!result.ok) { setError(errorText(result.error)); return }; dirty.current = false; await onSaved(result.value) }
    catch { setError(msg('serversPage.saveIncompleteRetry')) } finally { setBusy(false) }
  }
  return <><Dialog className="credential-drawer server-drawer" labelledBy="server-editor-title" onDismiss={dismiss}><form onSubmit={(event) => void save(event)} onChange={() => { dirty.current = true }} autoComplete="off">
    <div className="drawer-heading"><div><span className="page-label">{msg('serversPage.sshConnection')}</span><h2 id="server-editor-title">{binding ? msg('agentWorkspace.boundCredentials') : server ? msg('serversPage.editServer') : msg('serversPage.addServer')}</h2></div><button type="button" className="icon-button" disabled={busy} aria-label={msg('serversPage.closeServerEditor')} onClick={dismiss}><X size={20} /></button></div>
    <div className="drawer-content"><label className="drawer-field">{msg('agentWorkspace.name')}<input name="name" placeholder={msg('serversPage.serverName')} required maxLength={100} defaultValue={server?.name} disabled={busy} data-initial-focus={!binding ? true : undefined} /></label>
      <div className="server-address-fields"><label className="drawer-field">{msg('serversPage.hostAddress')}<input name="host" placeholder={msg('serversPage.hostOrIp')} required maxLength={253} defaultValue={server?.host} disabled={busy} spellCheck={false} /><small>{msg('serversPage.enterIpv6AddressesDirectlyWithoutBrackets')}</small></label><label className="drawer-field">{msg('applicationsPanel.port')}<input name="port" type="number" required min={1} max={65535} defaultValue={server?.port ?? 22} disabled={busy} /></label></div>
      <label className="drawer-field">{msg('serversPage.username')}<input name="username" placeholder={msg('agentWorkspace.sshLoginAccount')} required maxLength={128} defaultValue={server?.username} disabled={busy} spellCheck={false} /></label>
      <div className="server-binding-section"><label className="drawer-field">{msg('agentWorkspace.boundCredentials')}<select name="credentialId" value={loginCredentialId} onChange={e => setLoginCredentialId(e.target.value)} disabled={busy} data-initial-focus={binding ? true : undefined}><option value="">{msg('serversPage.doNotBindYet')}</option>{credentialTypes.map((type) => <optgroup key={type.kind} label={type.label}>{credentials.filter((item) => item.kind === type.kind).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select><small>{credentials.length ? msg('serversPage.saveFirstThenBindCredentialsBeforeTesting') : msg('serversPage.noCredentialsYetSaveTheServerFirstThen')}</small></label></div>
      <div className="server-binding-section"><label className="security-checkbox"><input type="checkbox" checked={sudoEnabled} disabled={busy} onChange={e => setSudoEnabled(e.target.checked)} />{msg('serversPage.enableSudoElevation')}</label>{sudoEnabled && <><label className="drawer-field">{msg('serversPage.elevationPasswordSource')}<select aria-label={msg('serversPage.elevationPasswordSource')} value={sudoSource} disabled={busy} onChange={e => setSudoSource(e.target.value as typeof sudoSource)}><option value="login">{msg('serversPage.reuseLoginCredentialPassword')}</option><option value="credential">{msg('serversPage.bindASeparatePasswordCredential')}</option><option value="none">{msg('serversPage.passwordlessSudoConfiguredOnServer')}</option></select></label>{sudoSource === 'login' && credentials.find(c => c.id === loginCredentialId)?.kind !== 'password' && <p className="drawer-error">{msg('serversPage.reuseRequiresAPasswordLoginCredentialWithAn')}</p>}{sudoSource === 'credential' && <label className="drawer-field">{msg('serversPage.elevationPasswordCredential')}<select name="sudoCredentialId" required disabled={busy} defaultValue={server?.elevation?.type === 'sudo' ? server.elevation.credentialId ?? '' : ''}><option value="" disabled>{msg('serversPage.selectPasswordCredential')}</option>{credentials.filter(c => c.kind === 'password').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}<small>{msg('serversPage.runsAsRootOnlyWhenExplicitlyRequestedAnd')}</small></>}</div>
      <div className="server-binding-section"><label className="drawer-field">{msg('serversPage.connectionRoute')}<select value={routeType} disabled={busy} onChange={(event) => setRouteType(event.target.value as ServerRoute['type'])}><option value="direct">{msg('serversPage.direct')}</option><option value="ssh-jump">{msg('serversPage.sshJumpHost')}</option><option value="socks5">{msg('serversPage.socks5Proxy')}</option></select></label>
        {routeType === 'ssh-jump' && <label className="drawer-field">{msg('serversPage.jumpServer')}<select name="jumpServerId" required defaultValue={server?.route.type === 'ssh-jump' ? server.route.serverId : ''} disabled={busy}><option value="" disabled>{msg('serversPage.selectJumpServer')}</option>{servers.filter((item) => item.id !== server?.id && item.route.type === 'direct' && item.credentialId).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.host}</option>)}</select><small>{msg('serversPage.chooseADirectServerWithBoundCredentialsJump')}</small></label>}
        {routeType==='socks5'&&<label className="drawer-field">{msg('serversPage.socks5Proxy')}<select required value={proxyId} disabled={busy||proxiesLoading} onChange={e=>setProxyId(e.target.value)}><option value="" disabled>{msg('proxies.select')}</option>{proxies.map(p=><option key={p.id} value={p.id}>{p.name} · {p.route.host}:{p.route.port}</option>)}</select><small>{msg(proxies.length?'proxies.shared':'proxies.empty')}</small></label>}
      </div>
      {error && <div className="drawer-error" role="alert">{error}</div>}
    </div><div className="drawer-bottom"><p><ShieldCheck size={14} />{msg('serversPage.verifyTheServerHostFingerprintOnFirstConnection')}</p><div><button type="button" className="quiet-button" disabled={busy} onClick={dismiss}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy}>{busy ? msg('agentWorkspace.saving') : msg('serversPage.saveServer')}</button></div></div>
  </form></Dialog>{discard && <Dialog className="credential-confirm" labelledBy="server-discard-title" onDismiss={() => setDiscard(false)}><h2 id="server-discard-title">{msg('agentWorkspace.discardUnsavedChanges')}</h2><p>{msg('credentialsPage.thisInputWillNotBeSaved')}</p><div className="confirm-actions"><button className="quiet-button" data-initial-focus onClick={() => setDiscard(false)}>{msg('agentWorkspace.keepEditing')}</button><button className="destructive-button" onClick={onClose}>{msg('agentWorkspace.discardChanges')}</button></div></Dialog>}</>
}
function HostKeyDialog({ challenge, server, busy, onClose, onTrust }: { challenge: Challenge; server: ServerRecord; busy: boolean; onClose: () => void; onTrust: () => void }) {
  const [checked, setChecked] = useState(false)
  const [expired, setExpired] = useState(Date.now() >= challenge.expiresAt)
  useEffect(() => { const timer = window.setTimeout(() => setExpired(true), Math.max(0, challenge.expiresAt - Date.now())); return () => window.clearTimeout(timer) }, [challenge.expiresAt])
  return <Dialog className="credential-confirm host-key-dialog" labelledBy="host-key-title" onDismiss={() => { if (!busy) onClose() }}><span className="host-key-symbol"><ShieldCheck size={24} /></span><h2 id="host-key-title">{challenge.role === 'jump' ? msg('serversPage.verifyJumpHostFingerprint') : msg('serversPage.verifyTargetFingerprint')}</h2><p>{msg('serversPage.firstConnectionTo')} {challenge.serverName ?? server.name}{msg('serversPage.verifyThisFingerprintThroughTheServerAdministratorOr')}</p><div className="host-key-details"><span>{challenge.host}:{challenge.port} · {challenge.keyType}</span><code>{challenge.fingerprint}</code></div><label className="security-checkbox"><input type="checkbox" checked={checked} disabled={busy || expired} onChange={(event) => setChecked(event.target.checked)} data-initial-focus />{msg('serversPage.iVerifiedTheFingerprintThroughATrustedChannel')}</label><p className="host-key-explanation">{msg('serversPage.loginCredentialsAreNotSentToThisServer')}</p>{expired && <div className="drawer-error" role="alert">{msg('serversPage.fingerprintConfirmationExpiredCloseAndTestAgain')}</div>}<div className="confirm-actions"><button className="quiet-button" disabled={busy} onClick={onClose}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy || !checked || expired} onClick={onTrust}>{busy ? msg('serversPage.verifying') : msg('serversPage.trustAndContinue')}</button></div></Dialog>
}
