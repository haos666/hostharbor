import { reportBackgroundAssets } from '../src/shared/report-background-assets'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspectionReportInputSchema, type InspectionReport } from '../src/shared/inspection'
import { reportHtml, reportMarkdown } from '../src/main/inspection-report-format'
import { setLocale } from '../src/shared/i18n'
const op='00000000-0000-4000-8000-000000000001',serverId='00000000-0000-4000-8000-000000000002',at=1800000000000
function fixture(){
 const report:InspectionReport={id:serverId,serverId,profileId:serverId,profileName:'Synthetic agent',receivedAt:at+2000,requestHash:'0'.repeat(64),requestKey:'synthetic-dashboard',startedAt:at,finishedAt:at+1000,serverRevision:1,planRevision:1,planDigest:'0'.repeat(64),status:'abnormal',contextChanged:false,summary:'Synthetic inspection: one service needs attention. Resource samples are available.',plan:{serverId,serverRevision:1,revision:1,digest:'0'.repeat(64),contextDigest:'synthetic',updatedAt:at,title:'Synthetic checklist',markdown:'## Synthetic resources\nRead current samples.\n\n## Synthetic application\nInspect maintained service.\n\n## Synthetic certificate\nCheck expiry.',applicationIds:[],applicationRefs:[],checks:[{id:'check-1',title:'Synthetic resources'},{id:'check-2',title:'Synthetic application'},{id:'check-3',title:'Synthetic certificate'}]},items:[
 {checkId:'check-1',section:'system',status:'normal',finding:'Synthetic CPU, memory and filesystem samples collected.',operationIds:[op],metrics:[{kind:'cpu',usagePercent:23.7,observedAt:at,operationId:op},{kind:'memory',usedBytes:6*1024**3,totalBytes:16*1024**3,observedAt:at,operationId:op},{kind:'disk',mount:'/',usedBytes:42*1024**3,totalBytes:100*1024**3,observedAt:at,operationId:op},{kind:'disk',mount:'/srv/synthetic-data',usedBytes:170*1024**3,totalBytes:200*1024**3,observedAt:at,operationId:op}]},
 {checkId:'check-2',section:'application',subject:'Synthetic API',status:'abnormal',finding:'Synthetic service is inactive. No automatic repair was performed.',operationIds:[op]},
 {checkId:'check-3',section:'custom',subject:'Synthetic certificate',status:'incomplete',finding:'Synthetic certificate source is unavailable. Expiry is not confirmed.',operationIds:[]},
 ],evidence:[{id:op,state:'succeeded',exitCode:0,createdAt:at}]}
 return {report,serverName:'Synthetic server'}
}
afterEach(()=>setLocale('zh-CN'))
describe('offline inspection dashboard',()=>{
 it('validates optional typed capacity/CPU measurements without altering old report inputs',()=>{
  const f=fixture(),{id,profileId,profileName,receivedAt,status,plan,contextChanged,requestHash,evidence,...input}=f.report
  expect(inspectionReportInputSchema.parse(input).items[0].metrics).toHaveLength(4)
  const invalid=(metric:unknown)=>({...input,items:[{...input.items[0],metrics:[metric]}]})
  const base={kind:'memory',usedBytes:1,totalBytes:2,observedAt:at,operationId:op}
  for(const metric of [{...base,usedBytes:3},{...base,totalBytes:0},{...base,usedBytes:-1},{...base,usedBytes:1.5},{kind:'cpu',usagePercent:101,observedAt:at,operationId:op},{kind:'cpu',usagePercent:NaN,observedAt:at,operationId:op},{...base,operationId:'other'},{...base,html:'<script>'}])expect(inspectionReportInputSchema.safeParse(invalid(metric)).success).toBe(false)
  const legacy={...input,items:[{checkId:'check-1',status:'incomplete',finding:'Synthetic legacy check',operationIds:[]}]}
  expect(inspectionReportInputSchema.parse(legacy)).toEqual(legacy)
 })
 it('renders real point samples, every disk and three sections in both languages with no scripts or external resources',()=>{
  for(const locale of ['en','zh-CN'] as const){setLocale(locale);const f=fixture(),html=reportHtml(f)
   expect(html).toContain('23.7');expect(html).toContain('6 GiB');expect(html).toContain('85%');expect(html).toContain('/srv/synthetic-data');expect(html).toContain('Synthetic API');expect(html).toContain('id="system"');expect(html).toContain('id="application"');expect(html).toContain('id="custom"');expect(html).not.toMatch(/<script|<iframe|<img|(?:src|href)="https?:\/\//i);expect(html).toContain("default-src 'none'");expect(reportMarkdown(f)).toContain('23.7%')
   if(process.env.HH_DASHBOARD_PREVIEW_DIR){mkdirSync(process.env.HH_DASHBOARD_PREVIEW_DIR,{recursive:true});writeFileSync(join(process.env.HH_DASHBOARD_PREVIEW_DIR,`synthetic-${locale}.html`),html);for(const background of ['default','aurora','grid','nebula'] as const){writeFileSync(join(process.env.HH_DASHBOARD_PREVIEW_DIR,`synthetic-${locale}-${background}.html`),reportHtml({...f,background}));const legacy={...f,report:{...f.report,items:f.report.items.map(({section,subject,metrics,...item})=>item)}};writeFileSync(join(process.env.HH_DASHBOARD_PREVIEW_DIR,`legacy-${locale}-${background}.html`),reportHtml({...legacy,background}))}}
  }
 })
 it('embeds only bundled backgrounds in offline HTML and keeps report text and Markdown unchanged',()=>{
  const f=fixture(),markdown=reportMarkdown(f)
  for(const background of ['default','aurora','grid','nebula'] as const){const d={...f,background},html=reportHtml(d);expect(html).toContain(`data-background="${background}"`);expect(html).toContain('img-src data:');expect(reportMarkdown(d)).toBe(markdown);expect(html).toContain(f.report.summary)
   if(background!=='default'){expect(reportBackgroundAssets[background]).toMatch(/^data:image\/jpeg;base64,/);expect(html).toContain(reportBackgroundAssets[background]);expect(html).toContain('@media print{body{background:white!important}}')}
  }
 })
 it('retains every finding, review reason, metric and evidence reference across all four report compositions',()=>{
  setLocale('en');const f=fixture();f.report.items[1].ignored={reason:'Synthetic expected application state',at};f.report.originalStatus='abnormal';f.report.ignoredCount=1;f.report.status='incomplete'
  for(const background of ['default','aurora','grid','nebula'] as const){const html=reportHtml({...f,background});for(const item of f.report.items){expect(html).toContain(item.finding);expect(html).toContain(item.checkId)}expect(html).toContain('Synthetic expected application state');expect(html).toContain(op);expect(html).toContain('23.7');expect(html).toContain('Ignored<strong>1</strong>');expect(html).toContain('Abnormal<strong>0</strong>');expect(html).not.toContain('<script>')}
 })
 it('keeps legacy findings in custom section and never invents resource numbers from prose',()=>{setLocale('en');const f=fixture();for(const i of f.report.items){delete i.metrics;delete i.section}f.report.summary='CPU 50%, memory 2 GiB (synthetic old prose)';const html=reportHtml(f);expect(html.match(/Not collected/g)?.length).toBeGreaterThan(2);expect(html).not.toContain('class="needle"');expect(html).toContain('Unclassified historical checks');expect(html).toContain('class="count abnormal">Abnormal<strong>1</strong>')})
 it('escapes hostile report fields and keeps ignored findings visible outside anomaly counts',()=>{setLocale('en');const f=fixture(),i=f.report.items[1];i.subject='<svg onload=alert(1)>';i.finding='</p><script>bad()</script>';i.ignored={reason:'<iframe>synthetic</iframe>',at};f.report.status='incomplete';f.report.originalStatus='abnormal';f.report.ignoredCount=1;const html=reportHtml(f);expect(html).not.toContain('<script>');expect(html).not.toContain('<svg onload');expect(html).toContain('&lt;svg onload');expect(html).toContain('Ignored<strong>1</strong>');expect(html).toContain('Abnormal<strong>0</strong>');expect(html).toContain('Original summary')})
})
