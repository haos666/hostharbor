import { Toast } from './Toast'
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { errorText, getLocale, msg } from '../../../shared/i18n'
import { reportBackgrounds, type ReportBackground } from '../../../shared/report-style'
import defaultPreview from '../../../../resources/report-previews/default.jpg'
import auroraPreview from '../../../../resources/report-previews/aurora.jpg'
import gridPreview from '../../../../resources/report-previews/grid.jpg'
import nebulaPreview from '../../../../resources/report-previews/nebula.jpg'
import defaultEnglishPreview from '../../../../resources/report-previews/default-en.jpg'
import auroraEnglishPreview from '../../../../resources/report-previews/aurora-en.jpg'
import gridEnglishPreview from '../../../../resources/report-previews/grid-en.jpg'
import nebulaEnglishPreview from '../../../../resources/report-previews/nebula-en.jpg'
const englishPreviews={default:defaultEnglishPreview,aurora:auroraEnglishPreview,grid:gridEnglishPreview,nebula:nebulaEnglishPreview}
const chinesePreviews={default:defaultPreview,aurora:auroraPreview,grid:gridPreview,nebula:nebulaPreview}
import { PageHeader } from './PageHeader'

export function ReportStyleSettings(){
 const previews=getLocale()==='en'?englishPreviews:chinesePreviews
 const [value,setValue]=useState<ReportBackground>('default'),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
 useEffect(()=>{let alive=true;void window.hostharbor.getReportStyle().then(r=>{if(alive){if(r.ok)setValue(r.value);else setError(r.error.code)}}).catch(()=>{if(alive)setError('STORAGE_FAILED')}).finally(()=>{if(alive)setLoaded(true)});return()=>{alive=false}},[])
 async function save(background:ReportBackground){if(busy||background===value)return;setBusy(true);setError('');setSaved(false);try{const r=await window.hostharbor.saveReportStyle(background);if(r.ok){setValue(r.value);setSaved(true)}else setError(r.error.code)}catch{setError('STORAGE_FAILED')}finally{setBusy(false)}}
 return <section className="report-style-settings"><PageHeader label={msg('aiSettings.settings')} title={msg('reportStyle.title')}/><p className="report-style-description">{msg('reportStyle.description')}</p><fieldset className="report-style-options" disabled={!loaded||busy}><legend className="sr-only">{msg('reportStyle.background')}</legend>{reportBackgrounds.map(background=><label key={background} className={`report-style-option${value===background?' selected':''}`}><div className="report-style-thumbnail"><img src={previews[background]} alt=""/><input type="radio" name="report-background" value={background} checked={value===background} onChange={()=>void save(background)}/></div><div className="report-style-caption"><div><strong>{msg(`reportStyle.${background}`)}</strong><small>{msg(`reportStyle.${background}Description`)}</small></div>{value===background&&<Check size={16} aria-hidden="true"/>}</div></label>)}</fieldset>{saved&&<Toast message={msg('reportStyle.saved')} onDismiss={()=>setSaved(false)}/>}{error&&<Toast message={errorText({code:error})} error onDismiss={()=>setError('')}/>}</section>
}
