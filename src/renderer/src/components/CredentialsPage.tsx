import { msg, errorText } from '../../../shared/i18n'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, FileKey2, KeyRound, LockKeyhole, Pencil, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import type { AppStatus, CredentialInput, CredentialSummary, ServerRecord } from '../../../shared/contracts'
import { credentialLabel, credentialTypes, credentialUsage } from '../credential-types'
import { Dialog } from './Dialog'
import { UnlockGate } from './SecuritySettings'

type Kind = CredentialSummary['kind']
type Notice = { error: boolean; text: string }
const api = window.hostharbor

function TypeIcon({ kind, size = 18 }: { kind: Kind; size?: number }) {
  return kind === 'password' ? <KeyRound size={size} /> : <FileKey2 size={size} />
}

export function CredentialsPage({ status, credentials, servers, busy, message, onDismissMessage, onRefresh, onSetup }: {
  status: AppStatus | null
  credentials: CredentialSummary[]
  servers: ServerRecord[]
  busy: boolean
  message: Notice | null
  onDismissMessage: () => void
  onRefresh: () => Promise<void>
  onSetup: () => void
}) {
  const [filter, setFilter] = useState<'all' | Kind>('all')
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<CredentialSummary | 'new' | null>(null)
  const [initialKind, setInitialKind] = useState<Kind>('password')
  const [deleting, setDeleting] = useState<CredentialSummary | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const unlocked = status?.vault === 'unlocked'
  const search = query.trim().toLocaleLowerCase()
  const visible = credentials.filter((credential) => (filter === 'all' || credential.kind === filter) && credential.name.toLocaleLowerCase().includes(search))
  useEffect(() => {
    if (!unlocked) { setEditor(null); setDeleting(null); setQuery(''); setNotice(null) }
  }, [unlocked])
  useEffect(() => {
    if (!notice || notice.error) return
    const timer = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])
  function add() { onDismissMessage(); setInitialKind(filter === 'all' ? 'password' : filter); setEditor('new'); setNotice(null) }
  async function saved(kind: Kind) {
    onDismissMessage(); setEditor(null); setFilter(kind); setQuery(''); setNotice({ error: false, text: msg('credentialsPage.credentialSaved') })
    try { await onRefresh() } catch { setNotice({ error: true, text: msg('credentialsPage.credentialSavedListRefreshFailed') }) }
  }
  async function remove() {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      const result = await api.deleteCredential(deleting.id)
      if (!result.ok) { setNotice({ error: true, text: errorText(result.error) }); setDeleting(null); return }
      setDeleting(null); onDismissMessage(); setNotice({ error: false, text: msg('credentialsPage.credentialDeleted') })
      try { await onRefresh() } catch { setNotice({ error: true, text: msg('credentialsPage.credentialDeletedListRefreshFailed') }) }
    } catch { setNotice({ error: true, text: msg('credentialsPage.operationIncompleteRetry') }) }
    finally { setDeletingBusy(false) }
  }
  const displayedNotice = notice ?? message
  return <section className="credentials-page">
    <header className="credentials-header">
      <div className="credentials-title"><span className="page-label">{msg('credentialsPage.connectionManagement')}</span><h1>{msg('credentialsPage.credentials')}{unlocked && credentials.length > 0 && <span className="total-count">{credentials.length}</span>}</h1></div>
      {unlocked && <button className="credential-primary" onClick={add}><Plus size={16} />{msg('credentialsPage.addCredential')}</button>}
    </header>
    {displayedNotice && <div className={`credential-notice ${displayedNotice.error ? 'is-error' : ''}`} role={displayedNotice.error ? 'alert' : 'status'}>
      {!displayedNotice.error && <Check size={16} />}<span>{displayedNotice.text}</span><button aria-label={msg('agentWorkspace.dismissMessage')} onClick={() => { setNotice(null); onDismissMessage() }}><X size={15} /></button>
    </div>}
    {!unlocked ? <UnlockGate status={status} onRefresh={onRefresh} onSetup={onSetup} /> : <>
      <div className="credentials-controls">
        <div className="credential-tabs" role="group" aria-label={msg('credentialsPage.credentialCategories')}>
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{msg('approvalSettings.all')}{credentials.length > 0 && <span>{credentials.length}</span>}</button>
          {credentialTypes.map((type) => {
            const count = credentials.filter((credential) => credential.kind === type.kind).length
            return <button key={type.kind} aria-pressed={filter === type.kind} onClick={() => setFilter(type.kind)}>{type.label}{count > 0 && <span>{count}</span>}</button>
          })}
        </div>
        <div className="credential-search"><Search size={16} /><input aria-label={msg('credentialsPage.searchCredentialNames')} placeholder={msg('credentialsPage.searchCredentials')} value={query} onKeyDown={event => { if (event.key === 'Escape') setQuery('') }} onChange={(event) => setQuery(event.target.value)} />{query && <button aria-label={msg('credentialsPage.clearSearch')} onClick={() => setQuery('')}><X size={14} /></button>}</div>
      </div>
      <div className="credentials-surface">
        {visible.length > 0 ? <div className="credential-table" role="table" aria-label={msg('credentialsPage.credentialList')}>
          <div className="credential-table-head" role="row"><span role="columnheader">{msg('agentWorkspace.name')}</span><span role="columnheader">{msg('credentialsPage.type')}</span><span role="columnheader">{msg('credentialsPage.linkedServers')}</span><span role="columnheader" className="row-actions-heading">{msg('credentialsPage.actions')}</span></div>
          {visible.map((credential) => {
            const count = credentialUsage(servers, credential.id)
            return <div className="credential-row" role="row" key={credential.id}>
              <div className="credential-name-cell" role="cell"><span className={`credential-kind-icon ${credential.kind}`}><TypeIcon kind={credential.kind} /></span><button className="credential-name" onClick={() => { setInitialKind(credential.kind); setEditor(credential) }}>{credential.name}</button></div>
              <div role="cell"><span className="kind-label">{credentialLabel(credential.kind)}</span></div>
              <div role="cell" className="credential-usage">{count > 0 ? msg('approvalSettings.valueServers', { value0: count }) : msg('credentialsPage.notLinked')}</div>
              <div role="cell" className="credential-row-actions"><button className="icon-button" aria-label={msg('applicationsPanel.editValue', { value0: credential.name })} title={msg('credentialsPage.editCredential')} onClick={() => { setInitialKind(credential.kind); setEditor(credential) }}><Pencil size={16} /></button><button className="icon-button delete-action" aria-label={msg('applicationsPanel.deleteValue', { value0: credential.name })} title={count ? msg('credentialsPage.unlinkTheServersFirst') : msg('credentialsPage.deleteCredential')} disabled={count > 0} onClick={() => setDeleting(credential)}><Trash2 size={16} /></button></div>
            </div>
          })}
        </div> : <div className="credential-empty">
          <div className="empty-key"><KeyRound size={30} strokeWidth={1.4} /></div>
          <h2>{search ? msg('credentialsPage.noMatchingCredentials') : credentials.length === 0 ? msg('credentialsPage.addYourFirstCredential') : msg('credentialsPage.noValueCredentialsYet', { value0: filter === 'all' ? '' : credentialLabel(filter) })}</h2>
          <p>{search ? msg('credentialsPage.tryAnotherNameOrCategory') : msg('credentialsPage.saveAPasswordOrSshKeyForServer')}</p>
        </div>}
      </div>
    </>}
    {editor && unlocked && <CredentialDrawer credential={editor === 'new' ? null : editor} initialKind={initialKind} usage={editor === 'new' ? 0 : credentialUsage(servers, editor.id)} onClose={() => setEditor(null)} onSaved={saved} />}
    {deleting && unlocked && <Dialog className="credential-confirm" labelledBy="delete-title" onDismiss={() => { if (!deletingBusy) setDeleting(null) }}>
      <span className="confirm-icon"><Trash2 size={22} /></span><h2 id="delete-title">{msg('credentialsPage.deleteCredential2')}</h2><p>{msg('credentials.deleteBody', { name: deleting.name })}</p><div className="confirm-actions"><button className="quiet-button" disabled={deletingBusy} autoFocus data-initial-focus onClick={() => setDeleting(null)}>{msg('agentWorkspace.cancel')}</button><button className="destructive-button" disabled={deletingBusy} onClick={() => void remove()}>{deletingBusy ? msg('credentialsPage.deleting') : msg('credentialsPage.deleteCredential')}</button></div>
    </Dialog>}
  </section>
}

function CredentialDrawer({ credential, initialKind, usage, onClose, onSaved }: {
  credential: CredentialSummary | null
  initialKind: Kind
  usage: number
  onClose: () => void
  onSaved: (kind: Kind) => Promise<void>
}) {
  const [kind, setKind] = useState(initialKind)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const dirty = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  function dismiss() { if (saving) return; if (dirty.current) setDiscard(true); else onClose() }
  async function importFile(file: File | undefined) {
    if (!file) return
    if (file.size > 262144) { setError(msg('credentialsPage.privateKeyFileMustNotExceed256Kb')); return }
    try {
      const field = form.current?.elements.namedItem('privateKey') as HTMLTextAreaElement | null
      const text = await file.text()
      if (field?.isConnected) { field.value = text; dirty.current = true; setError('') }
    } catch { setError(msg('credentialsPage.cannotReadFileSelectItAgain')) }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('')
    const data = new FormData(event.currentTarget)
    const base = { ...(credential ? { id: credential.id } : {}), name: String(data.get('name')) }
    const input: CredentialInput = kind === 'password'
      ? { ...base, kind, password: String(data.get('password')) }
      : { ...base, kind, privateKey: String(data.get('privateKey')), passphrase: String(data.get('passphrase') || '') }
    for (const name of ['password', 'privateKey', 'passphrase']) {
      const field = form.current?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null
      if (field) field.value = ''
    }
    if (fileInput.current) fileInput.current.value = ''
    try {
      const result = await api.saveCredential(input)
      if (!result.ok) { setError(errorText(result.error)); return }
      dirty.current = false
      await onSaved(kind)
    } catch { setError(msg('credentialsPage.saveFailedEnterTheDetailsAgainAndRetry')) }
    finally { setSaving(false) }
  }
  return <>
    <Dialog className="credential-drawer" labelledBy="credential-editor-title" onDismiss={dismiss}>
      <form ref={form} onSubmit={(event) => void save(event)} onChange={() => { dirty.current = true }} autoComplete="off">
        <div className="drawer-heading"><div><span className="page-label">{msg('credentialsPage.vault')}</span><h2 id="credential-editor-title">{credential ? msg('credentialsPage.editCredential') : msg('credentialsPage.addCredential')}</h2></div><button type="button" className="icon-button" aria-label={msg('credentialsPage.closeCredentialEditor')} disabled={saving} onClick={dismiss}><X size={20} /></button></div>
        <div className="drawer-content">
          <fieldset className="credential-type-picker" disabled={saving}><legend>{msg('credentialsPage.authenticationMethod')}</legend>{credentialTypes.map((type) => <label key={type.kind} className={kind === type.kind ? 'selected' : ''}><input type="radio" name="kind" value={type.kind} checked={kind === type.kind} onChange={() => { setKind(type.kind); setError('') }} /><TypeIcon kind={type.kind} size={19} /><span>{type.label}</span>{kind === type.kind && <Check size={14} className="selected-check" />}</label>)}</fieldset>
          <label className="drawer-field">{msg('agentWorkspace.name')}<input name="name" placeholder={msg('credentialsPage.credentialName')} required maxLength={100} defaultValue={credential?.name} disabled={saving} autoFocus data-initial-focus /></label>
          <div key={kind} className="secret-fields">
            {kind === 'password' ? <label className="drawer-field">{credential ? msg('credentialsPage.newPassword') : msg('credentialsPage.password')}<input name="password" type="password" placeholder={credential ? msg('credentialsPage.enterThePasswordAgainToUpdate') : msg('credentialsPage.enterLoginPassword')} autoComplete="new-password" required maxLength={65536} disabled={saving} /><small>{msg('credentialsPage.setTheUsernameInTheServerConnection')}</small></label> : <>
              <div className="key-field-heading"><span>{msg('credentialsPage.privateKey')}</span><button type="button" className="text-button" disabled={saving} onClick={() => fileInput.current?.click()}>{msg('credentialsPage.chooseFile')}</button><input ref={fileInput} type="file" hidden tabIndex={-1} aria-label={msg('credentialsPage.choosePrivateKeyFile')} onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = '' }} /></div>
              <textarea className="private-key-input" name="privateKey" aria-label={msg('credentialsPage.privateKeyContents')} placeholder={msg('credentialsPage.pasteAnOpensshPrivateKeyOrChooseA')} rows={9} required maxLength={262144} spellCheck={false} disabled={saving} />
              <label className="drawer-field">{msg('credentialsPage.privateKeyPassphrase')} <span className="optional-label">{msg('credentialsPage.optional')}</span><input name="passphrase" type="password" placeholder={msg('credentialsPage.leaveBlankIfThePrivateKeyIsUnencrypted')} autoComplete="new-password" maxLength={65536} disabled={saving} /></label>
            </>}
          </div>
          {usage > 0 && <div className="credential-impact">{msg('credentialsPage.thisCredentialIsLinkedTo')} {usage} {msg('credentialsPage.serversSavingAppliesToAllOfThem')}</div>}
          {error && <div className="drawer-error" role="alert">{error}</div>}
        </div>
        <div className="drawer-bottom"><p><ShieldCheck size={14} />{msg('credentialsPage.storedLocallyOnly')}</p><div><button type="button" className="quiet-button" disabled={saving} onClick={dismiss}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={saving}>{saving ? msg('agentWorkspace.saving') : msg('credentialsPage.saveCredential')}</button></div></div>
      </form>
    </Dialog>
    {discard && <Dialog className="credential-confirm" labelledBy="discard-title" onDismiss={() => setDiscard(false)}><h2 id="discard-title">{msg('agentWorkspace.discardUnsavedChanges')}</h2><p>{msg('credentialsPage.thisInputWillNotBeSaved')}</p><div className="confirm-actions"><button className="quiet-button" autoFocus data-initial-focus onClick={() => setDiscard(false)}>{msg('agentWorkspace.keepEditing')}</button><button className="destructive-button" onClick={onClose}>{msg('agentWorkspace.discardChanges')}</button></div></Dialog>}
  </>
}
