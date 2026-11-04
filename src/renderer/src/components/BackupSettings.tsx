import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Archive, Download, Upload, X } from 'lucide-react'
import type { AppStatus } from '../../../shared/contracts'
import type { BackupCounts, BackupPreview, BackupItem } from '../../../shared/backup'
import { errorText, getLocale, msg } from '../../../shared/i18n'
import type { Result } from '../../../shared/errors'
import { UnlockGate } from './SecuritySettings'
import { Dialog } from './Dialog'
const api = window.hostharbor
const unwrap = <T,>(result: Result<T>): T => { if (!result.ok) throw new Error(errorText(result.error)); return result.value }
function initialSelection(items: BackupItem[]) {
  const selected = new Set(items.filter(i => i.kind === 'credential' && i.status === 'new').map(i => i.id))
  for (let n=0;n<items.length;n++) { let changed=false; for (const i of items) if(i.status==='new'&&!selected.has(i.id)&&i.dependencies.every(id=>selected.has(id)||items.find(a=>a.id===id)?.status==='duplicate')){selected.add(i.id);changed=true} if(!changed)break }
  return selected
}
export function BackupSettings({ status, onRefresh, onSetup }: { status: AppStatus | null; onRefresh: () => Promise<void>; onSetup: () => void }) {
  const [counts,setCounts]=useState<BackupCounts|null>(null),[mode,setMode]=useState<'export'|'import'|null>(null)
  const [file,setFile]=useState<{id:string;name:string}|null>(null),[preview,setPreview]=useState<BackupPreview|null>(null)
  const [selected,setSelected]=useState(new Set<string>()),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [showPassword,setShowPassword]=useState(false),[expired,setExpired]=useState(false)
  const epoch=useRef(0),unlocked=status?.vault==='unlocked'
  const close=()=>{if(busy)return;setMode(null);setPreview(null);setFile(null);setSelected(new Set());setError('');void api.cancelBackup()}
  useEffect(()=>{const current=++epoch.current;setMode(null);setPreview(null);setFile(null);setSelected(new Set());setBusy(false);setError('');setNotice('');setCounts(null);if(unlocked)void api.backupSummary().then(r=>{if(current===epoch.current)setCounts(unwrap(r))}).catch(e=>{if(current===epoch.current)setError(e.message)});return()=>{epoch.current++;void api.cancelBackup()}},[unlocked,status?.lockRevision])
  useEffect(()=>{setShowPassword(false)},[mode])
  useEffect(()=>{setExpired(false);if(!preview)return;const timer=setTimeout(()=>setExpired(true),Math.max(0,preview.expiresAt-Date.now()));return()=>clearTimeout(timer)},[preview])
  async function job(run:()=>Promise<void>){if(busy)return;const current=epoch.current;setBusy(true);setError('');try{await run()}catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:msg('backup.failed'))}finally{if(current===epoch.current)setBusy(false)}}
  async function choose(){const current=epoch.current;await job(async()=>{const value=unwrap(await api.chooseBackupFile());if(current!==epoch.current)return;if(value){setFile(value);setMode('import');setPreview(null);setNotice('')}})}
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form),password=String(data.get('password')??''),current=epoch.current
    if(mode==='export'&&password!==data.get('confirm')){setError(msg('backup.passwordMismatch'));return}
    form.reset();void job(async()=>{
      if(mode==='export'){const value=unwrap(await api.exportBackup(password));if(current!==epoch.current)return;if(value){setMode(null);setNotice(msg('backup.exported'));setCounts(value)}}
      else if(file){const value=unwrap(await api.previewBackup({fileId:file.id,password}));if(current!==epoch.current)return;setPreview(value);setSelected(initialSelection(value.items));setPage(0)}
    })
  }
  function toggle(id:string,checked:boolean){if(!preview)return;const next=new Set(selected),items=preview.items
    if(checked){const add=(key:string)=>{const item=items.find(i=>i.id===key);if(!item||item.status==='duplicate'||item.status==='blocked'||next.has(key))return;next.add(key);for(const dep of item.dependencies)add(dep)};add(id)}
    else{next.delete(id);for(let n=0;n<items.length;n++){let changed=false;for(const i of items)if(next.has(i.id)&&i.dependencies.some(d=>!next.has(d)&&items.find(a=>a.id===d)?.status!=='duplicate')){next.delete(i.id);changed=true}if(!changed)break}}
    setSelected(next)
  }
  async function commit(){const current=epoch.current;await job(async()=>{if(!preview)return;const result=unwrap(await api.commitBackup({sessionId:preview.sessionId,servers:preview.items.filter(i=>i.kind==='server'&&selected.has(i.id)).map(i=>i.id),credentials:preview.items.filter(i=>i.kind==='credential'&&selected.has(i.id)).map(i=>i.id)}));if(current!==epoch.current)return;setMode(null);setPreview(null);setFile(null);setSelected(new Set());setNotice(msg('backup.imported',{servers:result.servers,credentials:result.credentials,skipped:result.skipped}));await onRefresh();if(current===epoch.current)setCounts(unwrap(await api.backupSummary()))})}
  const rows=preview?.items.slice(page*20,page*20+20)??[],pages=Math.max(1,Math.ceil((preview?.items.length??0)/20))
  return <section><header className="credentials-header"><div className="credentials-title"><span className="page-label">{msg('aiSettings.settings')}</span><h1>{msg('backup.title')}</h1></div></header>
    {!unlocked?<UnlockGate status={status} onRefresh={onRefresh} onSetup={onSetup}/>:<>
      {notice&&<p className="credential-notice" role="status">{notice}</p>}{error&&!mode&&<p className="drawer-error" role="alert">{error}</p>}
      <div className="backup-overview"><Archive size={23}/><div><h2>{msg('backup.assets')}</h2><p>{msg('backup.includes')}</p>{counts&&<span>{msg('backup.counts',{servers:counts.servers,credentials:counts.credentials,applications:counts.applications})}</span>}</div></div>
      <div className="backup-cards"><article className="security-card"><Download size={23}/><h2>{msg('backup.export')}</h2><p>{msg('backup.exportDescription')}</p><button className="credential-primary" disabled={busy||!counts} onClick={()=>{setMode('export');setNotice('');setError('')}}>{msg('backup.export')}</button></article>
      <article className="security-card"><Upload size={23}/><h2>{msg('backup.import')}</h2><p>{msg('backup.importDescription')}</p><button className="credential-secondary" disabled={busy} onClick={()=>void choose()}>{msg('backup.choose')}</button></article></div>
      <p className="security-footnote">{msg('backup.excludes')}</p>
    </>}
    {mode&&<Dialog className={`backup-dialog ${preview?'backup-preview-dialog':''}`} labelledBy="backup-title" onDismiss={close}>
      <header className="backup-dialog-header"><h2 id="backup-title">{preview?msg('backup.preview'):mode==='export'?msg('backup.export'):msg('backup.import')}</h2><button className="icon-button" type="button" aria-label={msg('backup.close')} disabled={busy} onClick={close}><X size={20}/></button></header>
      {busy&&<div className="backup-busy" role="status"><progress aria-label={msg('backup.processing')}/><span>{msg('backup.processing')}</span></div>}
      {error&&<p className="drawer-error" role="alert">{error}</p>}
      {!preview?<form onSubmit={submit} className="backup-password-form">
        {file&&<p className="backup-filename">{file.name}</p>}<p>{mode==='export'?msg('backup.passwordHelp'):msg('backup.enterPassword')}</p>
        <label>{msg('backup.password')}<input data-initial-focus name="password" type={showPassword?'text':'password'} required autoComplete="off" disabled={busy}/></label>
        {mode==='export'&&<label>{msg('backup.confirmPassword')}<input name="confirm" type={showPassword?'text':'password'} required autoComplete="off" disabled={busy}/></label>}
        <label className="backup-show-password"><input type="checkbox" checked={showPassword} onChange={e=>setShowPassword(e.target.checked)} disabled={busy}/>{msg('backup.showPassword')}</label>
        <footer className="backup-footer"><button type="button" className="credential-secondary" disabled={busy} onClick={close}>{msg('backup.cancel')}</button><button className="credential-primary" disabled={busy}>{mode==='export'?msg('backup.save'):msg('backup.preview')}</button></footer>
      </form>:<>
        <p className="backup-filename">{file?.name} · {new Date(preview.createdAt).toLocaleString(getLocale())}</p><p>{msg('backup.previewHelp')}</p>
        {expired&&<p className="drawer-error" role="alert">{msg('errors.BACKUP_SESSION')}</p>}
        <div className="backup-selection-toolbar"><span>{msg('backup.selected',{count:selected.size})}</span><button className="text-button" disabled={busy} onClick={()=>setSelected(initialSelection(preview.items))}>{msg('backup.selectNew')}</button><button className="text-button" disabled={busy} onClick={()=>setSelected(new Set())}>{msg('backup.clear')}</button></div>
        <div className="backup-table-scroll"><table className="backup-table"><thead><tr><th>{msg('backup.select')}</th><th>{msg('backup.name')}</th><th>{msg('backup.kind')}</th><th>{msg('backup.state')}</th></tr></thead><tbody>{rows.length?rows.map(i=><tr key={i.id}><td><input type="checkbox" aria-label={i.name} disabled={busy||i.status==='blocked'||i.status==='duplicate'} checked={selected.has(i.id)} onChange={e=>toggle(i.id,e.target.checked)}/></td><td><strong>{i.name}</strong>{i.detail&&<small>{i.detail}</small>}{i.reason==='dependency'&&<small>{msg('backup.dependency')}</small>}{i.reason==='host-key'&&<small>{msg('backup.hostKeyConflict')}</small>}</td><td>{i.kind==='server'?msg('backup.server'):msg('backup.credential')}</td><td><span className={`backup-state backup-state-${i.status}`}>{msg(`backup.state.${i.status}`)}</span></td></tr>):<tr><td colSpan={4}>{msg('backup.empty')}</td></tr>}</tbody></table></div>
        <div className="backup-pagination"><button type="button" className="credential-secondary" disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>{msg('backup.previous')}</button><span>{page+1} / {pages}</span><button type="button" className="credential-secondary" disabled={busy||page+1===pages} onClick={()=>setPage(p=>p+1)}>{msg('backup.next')}</button></div>
        <footer className="backup-footer"><button className="credential-secondary" disabled={busy} onClick={close}>{msg('backup.cancel')}</button><button className="credential-primary" disabled={busy||!selected.size||expired} onClick={()=>void commit()}>{msg('backup.confirmImport')}</button></footer>
      </>}
    </Dialog>}
  </section>
}
