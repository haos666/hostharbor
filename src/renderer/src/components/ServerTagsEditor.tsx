import { useRef, useState, type CSSProperties } from 'react'
import { Check, LoaderCircle, Pencil, Plus, Tag, Trash2, X } from 'lucide-react'
import { msg, errorText } from '../../../shared/i18n'
import type { ServerTag, ServerTags } from '../../../shared/server-tags'
import { Dialog } from './Dialog'

const palette=['#80cbb4','#6ba9ef','#a993e5','#e5ae68','#e18493','#8eb777','#97a8b4']
export function TagChip({tag}:{tag:ServerTag}){
 return <span className="server-tag-chip" title={tag.name} style={{'--tag-color':tag.color} as CSSProperties}><i/><span>{tag.name}</span></span>
}
export function ServerTagsEditor({initial,server,onClose,onSaved}:{initial:ServerTags;server?:{id:string;name:string};onClose:()=>void;onSaved:(state:ServerTags)=>void}){
 const [state,setState]=useState(()=>structuredClone(initial)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[discard,setDiscard]=useState(false)
 const [editing,setEditing]=useState<string|null>(null),[name,setName]=useState(''),[color,setColor]=useState(palette[0]),[deleting,setDeleting]=useState<ServerTag|null>(null)
 const dirty=useRef(false)
 function dismiss(){if(!busy){if(dirty.current||name.trim())setDiscard(true);else onClose()}}
 function upsert(){
  if(!name.trim())return
  if(!editing&&server&&(state.assignments[server.id]?.length??0)>=20){setError(msg('tags.perServerLimit'));return}
  if(state.tags.some(t=>t.id!==editing&&t.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase())){setError(msg('tags.duplicate'));return}
  if(!editing&&state.tags.length>=200){setError(msg('tags.limit'));return}
  const tag={...(editing?state.tags.find(t=>t.id===editing):{}),id:editing??crypto.randomUUID(),name:name.trim(),color}
  setState(old=>({...old,tags:editing?old.tags.map(t=>t.id===editing?tag:t):[...old.tags,tag],assignments:server&&!editing?{...old.assignments,[server.id]:[...(old.assignments[server.id]??[]),...(old.assignments[server.id]?.length>=20?[]:[tag.id])]}:old.assignments}))
  dirty.current=true;setEditing(null);setName('');setError('')
 }
 function toggle(id:string){if(!server)return;const current=state.assignments[server.id]??[];if(!current.includes(id)&&current.length>=20){setError(msg('tags.perServerLimit'));return}setState({...state,assignments:{...state.assignments,[server.id]:current.includes(id)?current.filter(t=>t!==id):[...current,id]}});dirty.current=true;setError('')}
 const pinnedCount=state.tags.filter(tag=>tag.pinned).length
 function toggleTab(id:string){const tag=state.tags.find(tag=>tag.id===id);if(!tag)return;if(!tag.pinned&&pinnedCount>=4){setError(msg('tags.tabLimit'));return}setState(old=>({...old,tags:old.tags.map(tag=>tag.id===id?{...tag,pinned:!tag.pinned}:tag)}));dirty.current=true;setError('')}
 function remove(){if(!deleting)return;setState(old=>({...old,tags:old.tags.filter(t=>t.id!==deleting.id),assignments:Object.fromEntries(Object.entries(old.assignments).map(([id,tags])=>[id,tags.filter(t=>t!==deleting.id)]))}));if(editing===deleting.id){setEditing(null);setName('')}setDeleting(null);dirty.current=true}
 async function save(){if(busy)return;if(name.trim()){setError(msg('tags.applyFirst'));return}setBusy(true);setError('');try{const result=await window.hostharbor.saveServerTags(state);if(!result.ok)setError(errorText(result.error));else onSaved(result.value)}catch{setError(msg('serversPage.saveIncompleteRetry'))}finally{setBusy(false)}}
 return <><Dialog className="server-tags-dialog" labelledBy="tags-title" onDismiss={dismiss}>
  <header className="tags-dialog-heading"><div><span className="page-label">{server?.name??msg('navigation.servers')}</span><h2 id="tags-title"><Tag size={20}/>{msg(server?'tags.assign':'tags.manage')}</h2></div><button className="icon-button" aria-label={msg('agentWorkspace.cancel')} onClick={dismiss} disabled={busy}><X size={20}/></button></header>
  <div className="tags-dialog-body">{!server&&<div className="tag-tabs-summary"><span>{msg('tags.tabHelp')}</span><strong>{pinnedCount} / 4</strong></div>}<div className="tags-editor-list">{!state.tags.length?<p className="tags-empty">{msg('tags.empty')}</p>:state.tags.map(tag=><div className={`tags-editor-row${server?'':' tag-tab-row'}`} key={tag.id}>
   {server?<label className="tag-assignment-choice"><input type="checkbox" checked={(state.assignments[server.id]??[]).includes(tag.id)} onChange={()=>toggle(tag.id)} disabled={busy}/><TagChip tag={tag}/></label>:<TagChip tag={tag}/>}
   {!server&&<label className="tag-tab-choice" title={!tag.pinned&&pinnedCount>=4?msg('tags.tabLimit'):undefined}><input type="checkbox" aria-label={msg('tags.addNamedToTabs',{name:tag.name})} checked={!!tag.pinned} disabled={busy||(!tag.pinned&&pinnedCount>=4)} onChange={()=>toggleTab(tag.id)}/><span>{msg('tags.addToTabs')}</span></label>}
   <span className="tags-use-count">{Object.values(state.assignments).filter(ids=>ids.includes(tag.id)).length}</span>
   <button className="icon-button" disabled={busy} aria-label={msg('applicationsPanel.editValue',{value0:tag.name})} onClick={()=>{setEditing(tag.id);setName(tag.name);setColor(tag.color);setError('')}}><Pencil size={15}/></button><button className="icon-button delete-action" disabled={busy} aria-label={msg('applicationsPanel.deleteValue',{value0:tag.name})} onClick={()=>setDeleting(tag)}><Trash2 size={15}/></button>
  </div>)}</div>
  <form className="tag-create-form" onSubmit={event=>{event.preventDefault();upsert()}}><h3>{msg(editing?'tags.edit':'tags.create')}</h3><div className="tag-create-fields"><input data-initial-focus aria-label={msg('tags.name')} placeholder={msg('tags.name')} value={name} maxLength={40} onChange={e=>setName(e.target.value)} disabled={busy}/><label className="tag-custom-color" title={msg('tags.color')}><input aria-label={msg('tags.color')} type="color" value={color} disabled={busy} onChange={e=>setColor(e.target.value)}/></label><button className="credential-secondary" disabled={busy||!name.trim()}>{editing?<Check size={15}/>:<Plus size={15}/ >}{msg(editing?'tags.apply':'tags.add')}</button></div><div className="tag-palette">{palette.map(value=><button type="button" key={value} style={{backgroundColor:value}} className={color===value?'selected':''} aria-label={value} aria-pressed={color===value} disabled={busy} onClick={()=>setColor(value)}/>)}{editing&&<button type="button" className="text-button" disabled={busy} onClick={()=>{setEditing(null);setName('')}}>{msg('agentWorkspace.cancel')}</button>}</div></form>
  {error&&<div className="drawer-error" role="alert">{error}</div>}</div>
  <footer className="tags-dialog-footer"><span>{server?`${(state.assignments[server.id]??[]).length} / 20`:msg('tags.shared')}</span><button className="quiet-button" disabled={busy} onClick={dismiss}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy} onClick={()=>void save()}>{busy?<LoaderCircle size={15} className="dossier-spin"/>:<Check size={15}/ >}{msg(busy?'agentWorkspace.saving':'tags.save')}</button></footer>
 </Dialog>{deleting&&<Dialog className="credential-confirm" labelledBy="delete-tag-title" onDismiss={()=>setDeleting(null)}><h2 id="delete-tag-title">{msg('tags.delete')}</h2><p>{msg('tags.deleteBody',{name:deleting.name})}</p><div className="confirm-actions"><button className="quiet-button" onClick={()=>setDeleting(null)}>{msg('agentWorkspace.cancel')}</button><button className="destructive-button" onClick={remove}>{msg('tags.delete')}</button></div></Dialog>}{discard&&<Dialog className="credential-confirm" labelledBy="discard-tags-title" onDismiss={()=>setDiscard(false)}><h2 id="discard-tags-title">{msg('agentWorkspace.discardUnsavedChanges')}</h2><div className="confirm-actions"><button className="quiet-button" onClick={()=>setDiscard(false)}>{msg('agentWorkspace.keepEditing')}</button><button className="destructive-button" onClick={onClose}>{msg('agentWorkspace.discardChanges')}</button></div></Dialog>}</>
}
