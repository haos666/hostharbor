import { Toast } from './Toast'
import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, LoaderCircle } from 'lucide-react'
import { msg, errorText } from '../../../shared/i18n'
import { Dialog } from './Dialog'
export function InspectionReportActions({serverId,id,compact=false}:{serverId:string;id:string;compact?:boolean}){
 const [choosing,setChoosing]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState<{error:boolean;text:string}|null>(null)
 const alive=useRef(true)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function run(format?:'md'|'docx'|'html'){
  if(busy)return;setBusy(true);setChoosing(false);setNotice(null)
  try{
   if(format){const r=await window.hostharbor.exportInspectionReport({serverId,id,format});if(!alive.current)return;if(!r.ok)setNotice({error:true,text:errorText(r.error)});else if(r.value)setNotice({error:false,text:msg('reportFiles.exported',{name:r.value.name})})}
   else{const r=await window.hostharbor.openInspectionDashboard({serverId,id});if(alive.current)setNotice(r.ok?{error:false,text:msg('reportFiles.opened')}:{error:true,text:errorText(r.error)})}
  }catch{if(alive.current)setNotice({error:true,text:msg('inspection.failed')})}finally{if(alive.current)setBusy(false)}
 }
 return <><div className={`report-file-actions${compact?' is-compact':''}`} aria-busy={busy}><button className={compact?'icon-button':'credential-secondary'} disabled={busy} title={msg('reportFiles.dashboard')} aria-label={msg('reportFiles.dashboard')} onClick={()=>void run()}>{busy?<LoaderCircle size={15} className="dossier-spin"/>:<ExternalLink size={15}/ >}{!compact&&msg('reportFiles.dashboard')}</button><button className={compact?'icon-button':'credential-secondary'} disabled={busy} title={msg('reportFiles.export')} aria-label={msg('reportFiles.export')} onClick={()=>setChoosing(true)}><Download size={15}/>{!compact&&msg('reportFiles.export')}</button></div>
 {notice&&<Toast message={notice.text} error={notice.error} onDismiss={()=>setNotice(null)}/>}
 {choosing&&<Dialog className="credential-confirm report-export-dialog" labelledBy="report-export-title" onDismiss={()=>setChoosing(false)}><h2 id="report-export-title">{msg('reportFiles.chooseFormat')}</h2><div className="report-format-options">{(['md','docx','html'] as const).map(format=><button key={format} className="credential-secondary" onClick={()=>void run(format)}>{format==='md'?'Markdown (.md)':format==='docx'?'Word (.docx)':'HTML (.html)'}</button>)}</div><div className="confirm-actions"><button className="quiet-button" onClick={()=>setChoosing(false)}>{msg('inspection.cancel')}</button></div></Dialog>}
 </>
}
