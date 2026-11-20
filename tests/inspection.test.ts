import { reportHtml } from '../src/main/inspection-report-format'
import { ServerTagsService } from '../src/core/servers/tags'
import { randomUUID } from 'node:crypto'
import { inspectionTemplate, inspectionPlanningPrompt, inspectionSteps } from '../src/shared/inspection-template'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { OperationService } from '../src/core/operations/service'
import { InvestigationService } from '../src/core/investigation/service'
import { ApplicationService } from '../src/core/applications/service'
import { AiService } from '../src/core/ai/service'
import { InspectionService } from '../src/core/inspection/service'
import { BackupService } from '../src/core/backup/service'
import { LocalMcpServer } from '../src/core/mcp/server'
import { inspectionChecks, type InspectionPlan, type InspectionReportInput } from '../src/shared/inspection'
import { MarkdownDocument } from '../src/renderer/src/components/MarkdownDocument'
import { sshFixture } from './helpers/routes'
const cleanup:(()=>Promise<unknown>|unknown)[]=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close()})
async function fixture(fetcher?:typeof fetch){
 const dir=mkdtempSync(join(tmpdir(),'hostharbor-inspection-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}))
 const remote=await sshFixture({exec:(command,stream)=>{const marker=command.match(/[a-f0-9]{48}/)![0];stream.write(`${marker}\0/fixture\0${command.includes('synthetic dashboard samples')?JSON.stringify({cpu:21.5,memoryUsed:4096,memoryTotal:16384,diskUsed:8192,diskTotal:32768}):'synthetic health result'}\n`);setTimeout(()=>{stream.exit(command.includes('synthetic failure')?5:0);stream.end()},5)}});cleanup.push(()=>remote.close())
 const servers=new ServerService(new Store(join(dir,'assets.sqlite'))),key=randomBytes(32);servers.unlock(key)
 const credential=servers.saveCredential({kind:'password',name:'Synthetic inspection login',password:'target-secret'})
 const server=servers.saveServer({name:'Synthetic inspection server',host:'127.0.0.1',port:remote.port,username:'target-user',credentialId:credential.id})
 const challenge=await servers.testConnection(server.id);if(challenge.status!=='host-key-required')throw Error('synthetic key');servers.trustHost(challenge.challengeId)
 const operations=new OperationService(servers),ai=new AiService(servers,1000,fetcher),investigations=new InvestigationService(operations,ai),applications=new ApplicationService(operations,investigations),inspections=new InspectionService(operations,applications,investigations,ai)
 cleanup.push(()=>{investigations.close();ai.close();operations.close();servers.close()})
 const profile=operations.createProfile({name:'Synthetic inspection agent',serverIds:[server.id],mode:'policy',expiresAt:null})
 const save=(markdown='## Disk check\nCheck capacity; report anomalies only.',revision=0)=>{const w=inspections.workspace(server.id);return inspections.save({serverId:server.id,revision,serverRevision:w.serverRevision,contextDigest:w.contextDigest,title:'Synthetic plan',markdown,applicationIds:[]})}
 const input=(plan:InspectionPlan):InspectionReportInput=>({serverId:server.id,serverRevision:server.revision,planRevision:plan.revision,planDigest:plan.digest,requestKey:'synthetic-report',startedAt:plan.updatedAt,finishedAt:Date.now(),summary:'Synthetic incomplete inspection',items:plan.checks.map(c=>({checkId:c.id,status:'incomplete',finding:'Synthetic evidence unavailable',operationIds:[]}))})
 return {dir,key,remote,servers,server,credential,operations,ai,investigations,applications,inspections,profile,save,input}
}
describe('server inspection workflow',()=>{
 async function reviewFixture(statuses:('abnormal'|'incomplete'|'normal')[],fetcher?:typeof fetch){
  const f=await fixture(fetcher),plan=f.save(statuses.map((_,i)=>`## Synthetic check ${i+1}\nCheck synthetic service state.`).join('\n\n')),op=f.operations.start(f.profile.profile.id,{serverId:f.server.id,requestKey:'review-evidence',command:'synthetic health query',cwd:'/'})
  f.operations.decide({id:op.id,approve:true});await vi.waitFor(()=>expect(f.operations.get(op.id).state).toBe('succeeded'))
  const input={...f.input(plan),finishedAt:Date.now(),summary:'Synthetic original findings',items:plan.checks.map((c,n)=>({checkId:c.id,status:statuses[n],finding:'Synthetic service is stopped',operationIds:statuses[n]==='incomplete'?[]:[op.id]}))}
  const submitted=f.inspections.submit(f.profile.profile.id,input),report=f.inspections.report({serverId:f.server.id,id:submitted.id})
  return {...f,plan,report,input,op}
 }
 it('binds dashboard measurements to successful same-item operations and the current inspection window',async()=>{
  const f=await reviewFixture(['normal']),base={kind:'cpu' as const,usagePercent:12.5,observedAt:f.op.createdAt,operationId:f.op.id}
  const submit=(metrics:unknown,extra:Record<string,unknown>={})=>f.inspections.submit(f.profile.profile.id,{...f.input,requestKey:randomUUID(),items:[{...f.input.items[0],section:'system',metrics,...extra}]})
  const saved=submit([base]);expect(f.inspections.report({serverId:f.server.id,id:saved.id}).items[0].metrics).toEqual([base])
  for(const [metrics,extra]of [[[base,base],{}],[[{...base,observedAt:f.input.startedAt-1}],{}],[[{...base,observedAt:f.input.finishedAt+1}],{}],[[{...base,operationId:randomUUID()}],{}],[[base],{section:'custom'}],[[base],{status:'incomplete'}]] as [unknown,Record<string,unknown>][]){expect(()=>submit(metrics,extra)).toThrow(expect.objectContaining({code:'INSPECTION_EVIDENCE'}))}
  const failed=f.operations.start(f.profile.profile.id,{serverId:f.server.id,requestKey:'synthetic-failed-metric',command:'synthetic failure',cwd:'/'})
  f.operations.decide({id:failed.id,approve:true});await vi.waitFor(()=>expect(f.operations.get(failed.id).state).toBe('failed'))
  expect(()=>f.inspections.submit(f.profile.profile.id,{...f.input,requestKey:randomUUID(),finishedAt:Date.now(),items:[{...f.input.items[0],status:'abnormal',section:'system',operationIds:[failed.id],metrics:[{...base,operationId:failed.id,observedAt:Date.now()}]}]})).toThrow(expect.objectContaining({code:'INSPECTION_EVIDENCE'}))
 })
 it('ignores individual anomalies, recomputes all views, supports undo and preserves immutable evidence/idempotency',async()=>{
  const f=await reviewFixture(['abnormal','abnormal']),raw=f.servers.store.db.prepare('SELECT detail FROM inspection_reports WHERE id=?').get(f.report.id)!.detail
  const once=f.inspections.ignore({serverId:f.server.id,id:f.report.id,checkId:'check-1',revision:0,ignored:true,reason:'Synthetic expected stop'})
  expect(once.status).toBe('abnormal');expect(once.ignoredCount).toBe(1);expect(once.items[0].status).toBe('abnormal')
  const both=f.inspections.ignore({serverId:f.server.id,id:f.report.id,checkId:'check-2',revision:1,ignored:true,reason:'Synthetic known exception'})
  expect(both.status).toBe('normal');expect(both.originalStatus).toBe('abnormal');expect(both.reviewRevision).toBe(2)
  expect(f.inspections.reports({serverId:f.server.id}).reports[0]).toMatchObject({status:'normal',ignoredCount:2,counts:{abnormal:0}})
  expect(f.inspections.catalog({kind:'reports',status:'abnormal'}).total).toBe(0);expect(f.inspections.catalog({kind:'plans'}).plans[0].latest?.status).toBe('normal')
  expect(f.servers.store.db.prepare('SELECT detail FROM inspection_reports WHERE id=?').get(f.report.id)!.detail).toEqual(raw)
  expect(f.inspections.submit(f.profile.profile.id,f.input).id).toBe(f.report.id)
  expect(()=>f.inspections.ignore({serverId:f.server.id,id:f.report.id,checkId:'check-1',revision:0,ignored:false})).toThrow(expect.objectContaining({code:'CONTEXT_CHANGED'}))
  expect(f.inspections.ignore({serverId:f.server.id,id:f.report.id,checkId:'check-1',revision:2,ignored:false}).status).toBe('abnormal')
  expect(readFileSync(join(f.dir,'assets.sqlite')).includes(Buffer.from('Synthetic expected stop'))).toBe(false)
  f.servers.lock();expect(()=>f.inspections.ignore({serverId:f.server.id,id:f.report.id,checkId:'check-1',revision:3,ignored:true})).toThrow(expect.objectContaining({code:'VAULT_LOCKED'}))
 })
 it('removes encrypted reviews when their server is deleted',async()=>{const f=await reviewFixture(['abnormal']);f.inspections.ignore({serverId:f.server.id,id:f.report.id,checkId:'check-1',revision:0,ignored:true});f.servers.deleteServer(f.server.id);expect(f.servers.store.db.prepare('SELECT value FROM metadata WHERE key=?').get('inspection-review:'+f.report.id)).toBeUndefined()})
 it('never treats an unperformed check as normal through ignoring another anomaly',async()=>{
  const f=await reviewFixture(['abnormal','incomplete'])
  expect(f.inspections.ignore({serverId:f.server.id,id:f.report.id,checkId:'check-1',revision:0,ignored:true}).status).toBe('incomplete')
  expect(()=>f.inspections.ignore({serverId:f.server.id,id:f.report.id,checkId:'check-2',revision:1,ignored:true})).toThrow(expect.objectContaining({code:'INSPECTION_EVIDENCE'}))
 })
 it('atomically appends a reviewed exception without adding checks or rewriting report snapshots',async()=>{
  const f=await reviewFixture(['abnormal']),w=f.inspections.workspace(f.server.id),instruction='Synthetic service may remain stopped.'
  const request={serverId:f.server.id,id:f.report.id,checkId:'check-1',planRevision:w.plan!.revision,serverRevision:w.serverRevision,contextDigest:w.contextDigest,reviewRevision:0,instruction,ignoreCurrent:true,reason:'Synthetic intended state',locale:'en'}
  const result=f.inspections.saveException(request);expect(result.status).toBe('normal');expect(result.plan.revision).toBe(1);expect(result.plan.markdown).not.toContain('Confirmed exceptions')
  const next=f.inspections.workspace(f.server.id).plan!;expect(next.revision).toBe(2);expect(next.markdown).toContain('**Confirmed exceptions**');expect(next.markdown).toContain(instruction);expect(next.checks).toHaveLength(1)
  expect(()=>f.inspections.saveException(request)).toThrow(expect.objectContaining({code:'CONTEXT_CHANGED'}));expect(f.inspections.workspace(f.server.id).plan?.revision).toBe(2)
  const second={...request,planRevision:2,reviewRevision:1,instruction:'x'.repeat(51)}
  expect(()=>f.inspections.saveException(second)).toThrow();expect(f.inspections.workspace(f.server.id).plan?.revision).toBe(2)
  f.inspections.removeReport({serverId:f.server.id,id:f.report.id});expect(f.servers.store.db.prepare('SELECT value FROM metadata WHERE key=?').get(`inspection-review:${f.report.id}`)).toBeUndefined()
 })
 it('rolls back a failed ignore together with checklist changes',async()=>{
  const f=await reviewFixture(['abnormal']),w=f.inspections.workspace(f.server.id),original=f.inspections.ignore.bind(f.inspections)
  f.inspections.ignore=()=>{throw Error('synthetic review write failure')}
  expect(()=>f.inspections.saveException({serverId:f.server.id,id:f.report.id,checkId:'check-1',planRevision:1,serverRevision:w.serverRevision,contextDigest:w.contextDigest,reviewRevision:0,instruction:'Synthetic service may remain stopped.',ignoreCurrent:true,locale:'en'})).toThrow('synthetic review write failure')
  f.inspections.ignore=original;expect(f.inspections.workspace(f.server.id).plan?.revision).toBe(1);expect(f.inspections.report({serverId:f.server.id,id:f.report.id}).ignoredCount).toBe(0)
 })
 it.each(['openai','anthropic'] as const)('generates a 50-character %s exception draft with consent and no save/SSH side effects',async provider=>{
  const requests:string[]=[];let output={instruction:'Synthetic service may remain stopped.',needsClarification:false},invalidate=()=>{}
  const fetcher:typeof fetch=async(_url,init)=>{requests.push(String(init?.body));invalidate();return new Response(JSON.stringify(provider==='openai'?{choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'synthetic-exception',type:'function',function:{name:'submit_inspection_exception',arguments:JSON.stringify(output)}}]}}]}:{stop_reason:'tool_use',content:[{type:'tool_use',id:'synthetic-exception',name:'submit_inspection_exception',input:output}]}))}
  const f=await reviewFixture(['abnormal'],fetcher),config=f.ai.save({revision:0,provider,baseUrl:'https://synthetic-ai.invalid/v1',apiKey:'synthetic-provider-key',model:'synthetic-model'}),sessions=f.remote.sessions
  const request={serverId:f.server.id,id:f.report.id,checkId:'check-1',reason:'Synthetic service is intentionally stopped.',aiRevision:config.revision,consent:true,locale:'en'}
  await expect(f.inspections.draftException({...request,consent:false},()=>{})).rejects.toMatchObject({code:'INVALID_INPUT'})
  const result=await f.inspections.draftException(request,()=>{});expect(Array.from(result.instruction).length).toBeLessThanOrEqual(50);expect(result.planRevision).toBe(1);expect(f.inspections.workspace(f.server.id).plan?.revision).toBe(1);expect(f.remote.sessions).toBe(sessions);expect(requests[0]).not.toContain('target-secret')
  output={instruction:'',needsClarification:true};await expect(f.inspections.draftException(request,()=>{})).rejects.toMatchObject({code:'INSPECTION_EXCEPTION'})
  output={instruction:'x'.repeat(51),needsClarification:false};await expect(f.inspections.draftException(request,()=>{})).rejects.toMatchObject({code:'INVALID_INPUT'})
  output={instruction:'Synthetic service may remain stopped.',needsClarification:false};invalidate=()=>{f.inspections.ignore({serverId:f.server.id,id:f.report.id,checkId:'check-1',revision:0,ignored:true})}
  await expect(f.inspections.draftException(request,()=>{})).rejects.toMatchObject({code:'CONTEXT_CHANGED'})
 })


 it('queries standalone desktop catalogs with current checklists, historical snapshots, filters and pagination',async()=>{
  const f=await fixture(),first=f.save()
  const other=f.servers.saveServer({name:'Synthetic other host',host:'other.invalid',port:22,username:'synthetic-user',credentialId:null}),w=f.inspections.workspace(other.id)
  f.inspections.save({serverId:other.id,serverRevision:w.serverRevision,contextDigest:w.contextDigest,revision:0,title:'Another checklist',markdown:'## Other check\nRead system status.',applicationIds:[]})
  const tag={id:randomUUID(),name:'Synthetic classification',color:'#80cbb4'};new ServerTagsService(f.servers).save({revision:0,tags:[tag],assignments:{[f.server.id]:[tag.id]}})
  for(let n=0;n<12;n++)f.inspections.submit(f.profile.profile.id,{...f.input(first),requestKey:'catalog-'+n})
  const catalog=f.inspections.catalog({kind:'plans'});expect(catalog.total).toBe(2);expect(catalog.configuredServerIds).toContain(other.id)
  expect(f.inspections.catalog({kind:'plans',tagId:tag.id}).plans.map(p=>p.serverId)).toEqual([f.server.id])
  expect(f.inspections.catalog({kind:'plans',query:'Another checklist'}).plans[0].latest).toBeNull()
  const rows=f.inspections.catalog({kind:'reports',serverId:f.server.id,status:'incomplete'});expect(rows.total).toBe(12);expect(rows.reports).toHaveLength(10);expect(f.inspections.catalog({kind:'reports',offset:10}).reports).toHaveLength(2)
  expect(f.inspections.catalog({kind:'reports',status:'abnormal'}).total).toBe(0)
  expect(f.inspections.catalog({kind:'reports',from:Date.now()+1000}).total).toBe(0)
  f.save('## New saved step\nRead service state.',first.revision)
  expect(f.inspections.catalog({kind:'reports'}).reports[0].planRevision).toBe(first.revision)
  expect(f.inspections.catalog({kind:'plans',serverId:f.server.id}).plans[0].revision).toBe(first.revision+1)
  f.inspections.removeReport({serverId:f.server.id,id:rows.reports[0].id});expect(f.inspections.catalog({kind:'reports'}).total).toBe(11)
  expect(()=>f.inspections.catalog({kind:'reports',from:100,to:1})).toThrow()
  f.servers.lock();expect(()=>f.inspections.catalog({kind:'plans'})).toThrow()
 })
 it('derives version-bound checks without treating fenced Markdown as executable content',()=>{
  expect(inspectionChecks('## First\n```sh\n## not a check\n```\n## Second')).toEqual([{id:'check-1',title:'First'},{id:'check-2',title:'Second'}])
  const html=renderToStaticMarkup(createElement(MarkdownDocument,{text:'## Safe\n<img src="https://synthetic.invalid/pixel">\n<script>synthetic()</script>\n![image](https://synthetic.invalid)'}))
  expect(html).not.toContain('<img');expect(html).not.toContain('<script>');expect(html).not.toContain('<a ')
 })
 it('encrypts plans, rejects stale saves, keeps manual content and reloads with independent service instances',async()=>{
  const f=await fixture(),first=f.save(),w=f.inspections.workspace(f.server.id)
  expect(w.plan).toMatchObject({revision:1,stale:false,checks:[{id:'check-1'}]})
  expect(()=>f.save('## Other',0)).toThrow(expect.objectContaining({code:'CONTEXT_CHANGED'}))
  expect(()=>f.save('No headings',1)).toThrow(expect.objectContaining({code:'INSPECTION_DOCUMENT'}))
  expect(()=>f.save('## Secret\ntarget-secret',1)).toThrow(expect.objectContaining({code:'INSPECTION_DOCUMENT'}))
  expect(readFileSync(join(f.dir,'assets.sqlite')).includes(Buffer.from(first.markdown))).toBe(false)
  const reloaded=new InspectionService(f.operations,f.applications,f.investigations,f.ai);expect(reloaded.workspace(f.server.id).plan?.markdown).toBe(first.markdown)
  f.save('## Edited manually',1);expect(f.inspections.workspace(f.server.id).plan?.revision).toBe(2)
 })
 it('removes duplicated AI introductions without mistaking fenced headings for check sections',()=>{expect(inspectionSteps('# Title\nTarget: repeated\nTarget: repeated\n```md\n## Not a check\n```\n## CPU\nSample current load.')).toBe('## CPU\nSample current load.');expect(inspectionSteps('# Title\nNo checks')).toBe('')})
 it('keeps bilingual default checklists small, bounded and unsaved regardless of application count',()=>{
  const apps=Array.from({length:20},(_,i)=>({id:'synthetic-'+i,name:'Synthetic service '+i}))
  for(const locale of ['zh-CN','en']){const doc=inspectionTemplate(locale,apps);expect(inspectionChecks(doc.markdown)).toHaveLength(3);expect(doc.applicationIds).toHaveLength(3);expect(doc.markdown).not.toMatch(/目标[：:]|Target:|15 seconds|10 remote commands|4 minutes/);expect(doc.markdown).toMatch(/byte|字节/);expect(doc.title).not.toMatch(/报告|report/i)}
  expect(inspectionPlanningPrompt).toContain('3-6');expect(inspectionPlanningPrompt).toContain('5000');expect(inspectionPlanningPrompt).toContain('not completed findings')
 })
 it('rejects AI suggestions that exceed six checks instead of returning an unbounded plan',async()=>{
  const f=await fixture(async()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'fixture-call',type:'function',function:{name:'submit_inspection_plan',arguments:JSON.stringify({title:'Synthetic checklist',markdown:Array.from({length:7},(_,i)=>'## Synthetic check '+i).join('\n')})}}]}}]})))
  const w=f.inspections.workspace(f.server.id),config=f.ai.save({revision:0,provider:'openai',baseUrl:'https://synthetic-ai.invalid/v1',apiKey:'synthetic-provider-key',model:'synthetic-model'})
  await expect(f.inspections.draft({serverId:f.server.id,revision:0,serverRevision:w.serverRevision,contextDigest:w.contextDigest,useAi:true,locale:'en',aiRevision:config.revision,consent:true},()=>{})).rejects.toMatchObject({code:'INSPECTION_DOCUMENT'})
  expect(f.inspections.workspace(f.server.id).plan).toBeNull()
 })
 it('creates an offline template from current applications without SSH/model requests or saving',async()=>{
  const f=await fixture(),a=f.applications.save({serverId:f.server.id,revision:0,name:'Synthetic app',aliases:[],description:'',environment:'',deploymentPath:'/srv/synthetic',runtime:'systemd',runtimeTarget:'synthetic.service',logSources:[]})
  const w=f.inspections.workspace(f.server.id),sessions=f.remote.sessions
  const draft=await f.inspections.draft({serverId:f.server.id,revision:0,serverRevision:w.serverRevision,contextDigest:w.contextDigest,useAi:false,locale:'en'},()=>{})
  expect(draft.markdown).toContain(`{{application:${a.id}}}`);expect(draft.applicationIds).toEqual([a.id]);expect(f.remote.sessions).toBe(sessions);expect(f.inspections.workspace(f.server.id).plan).toBeNull()
 })
 it.each(['openai','anthropic'] as const)('generates a %s draft only with consent, never overwrites manual content and rechecks context',async provider=>{
  const requests:string[]=[];let invalidate:(()=>void)|undefined
  const fetcher:typeof fetch=async(_url,init)=>{requests.push(String(init?.body));invalidate?.();const input={title:'Synthetic historical report',markdown:'# Synthetic historical report\n\nTarget: 10 remote commands, 15 seconds each.\n\nTarget: 10 remote commands, 15 seconds each.\n\n## Health\nInspect using maintained selectors; report only.'};return new Response(JSON.stringify(provider==='openai'?{choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'fixture-call',type:'function',function:{name:'submit_inspection_plan',arguments:JSON.stringify(input)}}]}}]}:{stop_reason:'tool_use',content:[{type:'tool_use',id:'fixture-call',name:'submit_inspection_plan',input}]}),{status:200})}
  const f=await fixture(fetcher),plan=f.save(),w=f.inspections.workspace(f.server.id)
  const config=f.ai.save({revision:0,provider,baseUrl:'https://synthetic-ai.invalid/v1',apiKey:'synthetic-provider-key',model:'synthetic-model'})
  const request={serverId:f.server.id,revision:1,serverRevision:w.serverRevision,contextDigest:w.contextDigest,useAi:true,locale:'en',aiRevision:config.revision,consent:true}
  await expect(f.inspections.draft({...request,consent:false},()=>{})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(requests).toHaveLength(0)
  const draft=await f.inspections.draft(request,()=>{});expect(draft.title).toBe('Server inspection checklist');expect(draft.markdown.startsWith('# Server inspection checklist\n')).toBe(true);expect(draft.markdown).not.toContain('Synthetic historical report');expect(draft.markdown).not.toContain('Target:');expect(draft.markdown).not.toContain('10 remote commands');expect(draft.markdown).not.toContain('15 seconds');expect(f.inspections.workspace(f.server.id).plan?.markdown).toBe(plan.markdown)
  expect(requests[0]).toContain('not a report');expect(requests[0]).toContain('NOT a runtime deadline');expect(requests[0]).not.toContain('10 remote commands');expect(requests[0]).toContain('bound the INPUT read before filtering');expect(requests[0]).toContain('No recursive discovery');expect(requests[0]).not.toContain('target-secret');expect(f.remote.sessions).toBe(0)
  invalidate=()=>{f.save('## Changed during generation',1)}
  await expect(f.inspections.draft(request,()=>{})).rejects.toMatchObject({code:'CONTEXT_CHANGED'})
 })
 it('blocks a late AI result on desktop lock without replacing the saved plan',async()=>{
  let locked=false
  const f=await fixture(async()=>{locked=true;return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'fixture-call',type:'function',function:{name:'submit_inspection_plan',arguments:JSON.stringify({title:'Late draft',markdown:'## Health'})}}]}}]}))})
  f.save();const w=f.inspections.workspace(f.server.id),config=f.ai.save({revision:0,provider:'openai',baseUrl:'https://synthetic-ai.invalid/v1',apiKey:'synthetic-provider-key',model:'synthetic-model'})
  await expect(f.inspections.draft({serverId:f.server.id,revision:1,serverRevision:w.serverRevision,contextDigest:w.contextDigest,useAi:true,locale:'en',aiRevision:config.revision,consent:true},()=>{if(locked)throw Error('synthetic desktop locked')})).rejects.toThrow('locked')
  expect(f.inspections.workspace(f.server.id).plan?.revision).toBe(1)
 })
 it('stores version-bound reports idempotently, derives status and keeps evidence snapshots from owned SSH operations',async()=>{
  const f=await fixture(),plan=f.save(),input=f.input(plan)
  const operation=f.operations.start(f.profile.profile.id,{serverId:f.server.id,requestKey:'synthetic-health',command:'synthetic health query',cwd:'/'})
  expect(()=>f.inspections.submit(f.profile.profile.id,{...input,items:[{...input.items[0],status:'normal',operationIds:[operation.id]}]})).toThrow(expect.objectContaining({code:'INSPECTION_EVIDENCE'}))
  f.operations.decide({id:operation.id,approve:true});await vi.waitFor(()=>expect(f.operations.get(operation.id).state).toBe('succeeded'))
  input.finishedAt=Date.now();input.items[0]={...input.items[0],status:'normal',finding:'Synthetic health passed',operationIds:[operation.id]}
  const saved=f.inspections.submit(f.profile.profile.id,input);expect(saved.status).toBe('normal');expect(f.inspections.submit(f.profile.profile.id,input).id).toBe(saved.id)
  expect(()=>f.inspections.submit(f.profile.profile.id,{...input,summary:'different'})).toThrow(expect.objectContaining({code:'REQUEST_CONFLICT'}))
  f.save('## New plan',1)
  const report=f.inspections.report({serverId:f.server.id,id:saved.id});expect(report.plan.revision).toBe(1);expect(report.evidence[0]).toMatchObject({id:operation.id,state:'succeeded',exitCode:0})
  expect(f.inspections.reports({serverId:f.server.id}).total).toBe(1)
  f.inspections.removeReport({serverId:f.server.id,id:saved.id});expect(f.inspections.reports({serverId:f.server.id}).total).toBe(0)
  expect(()=>f.inspections.submit(f.profile.profile.id,input)).toThrow(expect.objectContaining({code:'OPERATION_REMOVED'}))
 })
 it('rejects false normal reports, missing/duplicate checks, cross-owner evidence and invalid time/version claims',async()=>{
  const f=await fixture(),plan=f.save('## One\nInspect\n## Two\nInspect'),input=f.input(plan)
  expect(()=>f.inspections.submit(f.profile.profile.id,{...input,items:input.items.map(i=>({...i,status:'normal'}))})).toThrow()
  expect(()=>f.inspections.submit(f.profile.profile.id,{...input,items:[input.items[0],input.items[0]]})).toThrow()
  expect(()=>f.inspections.submit(f.profile.profile.id,{...input,planDigest:'0'.repeat(64)})).toThrow()
  expect(()=>f.inspections.submit(f.profile.profile.id,{...input,startedAt:0})).toThrow()
  const other=f.operations.createProfile({name:'Synthetic other',serverIds:[f.server.id],mode:'policy',expiresAt:null})
  const op=f.operations.start(other.profile.id,{serverId:f.server.id,requestKey:'other',command:'query',cwd:'/'})
  expect(()=>f.inspections.submit(f.profile.profile.id,{...input,items:input.items.map(i=>({...i,operationIds:[op.id]}))})).toThrow(expect.objectContaining({code:'ACCESS_DENIED'}))
 })
 it.each(['lock','revoke','expire','scope'] as const)('does not expose plans or accept reports after %s',async action=>{
  const f=await fixture(),plan=f.save(),input=f.input(plan),id=f.profile.profile.id
  if(action==='lock')f.servers.lock()
  if(action==='revoke')f.operations.revokeProfile(id)
  if(action==='expire')f.servers.store.db.prepare('UPDATE profiles SET expiresAt=? WHERE id=?').run(Date.now()-1,id)
  if(action==='scope')f.servers.store.db.prepare("UPDATE profiles SET serverIds='[]' WHERE id=?").run(id)
  expect(()=>f.inspections.getPlan(id,f.server.id)).toThrow();expect(()=>f.inspections.submit(id,input)).toThrow();expect(()=>f.inspections.listPlans(id,{})).toThrow()
 })
 it('marks changed application context stale and freezes the original report snapshot',async()=>{
  const f=await fixture(),plan=f.save(),input=f.input(plan)
  f.applications.save({serverId:f.server.id,revision:0,name:'Synthetic app',aliases:[],description:'',environment:'',deploymentPath:'',runtime:'unknown',runtimeTarget:'',logSources:[]})
  expect(f.inspections.workspace(f.server.id).plan?.stale).toBe(true)
  const result=f.inspections.submit(f.profile.profile.id,input);expect(result).toMatchObject({status:'incomplete',contextChanged:true})
 })
 it('supports manual handbooks before credential binding without granting MCP access',async()=>{
  const f=await fixture(),server=f.servers.saveServer({name:'Synthetic unbound server',host:'unbound.invalid',port:22,username:'fixture-user',credentialId:null}),w=f.inspections.workspace(server.id)
  const plan=f.inspections.save({serverId:server.id,serverRevision:w.serverRevision,contextDigest:w.contextDigest,revision:0,title:'Offline plan',markdown:'## Availability\nReport incomplete until connected.',applicationIds:[]})
  expect(plan.revision).toBe(1)
  expect(()=>f.operations.createProfile({name:'Cannot grant',serverIds:[server.id],mode:'policy',expiresAt:null})).toThrow()
 })
 it('requires same-server evidence and never accepts an execution failure as normal',async()=>{
  const f=await fixture(),plan=f.save(),input=f.input(plan)
  const second=f.servers.saveServer({name:'Synthetic other target',host:f.server.host,port:f.server.port,username:f.server.username,credentialId:f.credential.id})
  f.operations.updateProfile({id:f.profile.profile.id,revision:1,name:f.profile.profile.name,serverIds:[f.server.id,second.id],expiresAt:null})
  const other=f.operations.start(f.profile.profile.id,{serverId:second.id,requestKey:'other-target',command:'synthetic query',cwd:'/'})
  f.operations.decide({id:other.id,approve:true});await vi.waitFor(()=>expect(f.operations.get(other.id).state).toBe('succeeded'))
  input.finishedAt=Date.now();expect(()=>f.inspections.submit(f.profile.profile.id,{...input,items:[{...input.items[0],status:'normal',operationIds:[other.id]}]})).toThrow(expect.objectContaining({code:'INSPECTION_EVIDENCE'}))
  const failed=f.operations.start(f.profile.profile.id,{serverId:f.server.id,requestKey:'failed-query',command:'synthetic failure',cwd:'/'})
  f.operations.decide({id:failed.id,approve:true});await vi.waitFor(()=>expect(f.operations.get(failed.id).state).toBe('failed'))
  input.finishedAt=Date.now();input.items[0]={...input.items[0],status:'normal',operationIds:[failed.id]}
  expect(()=>f.inspections.submit(f.profile.profile.id,input)).toThrow(expect.objectContaining({code:'INSPECTION_EVIDENCE'}))
  input.items[0].status='abnormal';expect(f.inspections.submit(f.profile.profile.id,input).status).toBe('abnormal')
 })
 it('derives report counts, preserves partial status and rolls back a failed plan write',async()=>{
  const f=await fixture(),plan=f.save('## One\nCheck\n## Two\nCheck'),input=f.input(plan)
  input.items[0].status='not_applicable'
  expect(f.inspections.submit(f.profile.profile.id,input).status).toBe('incomplete')
  expect(f.inspections.reports({serverId:f.server.id}).reports[0].counts).toEqual({normal:0,abnormal:0,incomplete:1,not_applicable:1})
  f.servers.store.db.exec("CREATE TRIGGER synthetic_plan_failure BEFORE INSERT ON inspection_plans BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END")
  expect(()=>f.save('## Failed save',1)).toThrow()
  expect(f.inspections.workspace(f.server.id).plan?.revision).toBe(1)
  expect(f.servers.store.db.prepare('SELECT COUNT(*) n FROM inspection_plans').get()!.n).toBe(1)
 })
 it('exposes scoped plan/report tools over authenticated MCP without executing inspection automatically',async()=>{
  const f=await fixture(),plan=f.save(),mcp=new LocalMcpServer(f.operations,0,f.applications,undefined,f.inspections);cleanup.push(()=>mcp.stop());const endpoint=(await mcp.start()).url!
  const client=new Client({name:'untrusted supplied identity',version:'1'});cleanup.push(()=>client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:`Bearer ${f.profile.token}`}}}))
  const unpack=(r:unknown)=>JSON.parse((r as {content:{text:string}[]}).content[0].text)
  const tools=(await client.listTools()).tools;expect(tools.map(t=>t.name)).toEqual(expect.arrayContaining(['list_inspection_plans','get_inspection_plan','submit_inspection_report']))
  expect(unpack(await client.callTool({name:'list_inspection_plans',arguments:{}})).total).toBe(1)
  expect(unpack(await client.callTool({name:'get_inspection_plan',arguments:{serverId:f.server.id}})).plan.digest).toBe(plan.digest)
  const saved=unpack(await client.callTool({name:'submit_inspection_report',arguments:f.input(plan)}));expect(saved.status).toBe('incomplete');expect(f.remote.sessions).toBe(0)
  expect(f.inspections.report({serverId:f.server.id,id:saved.id}).profileName).toBe('Synthetic inspection agent')
 })
 it('carries current sampled values through authenticated MCP, encrypted reports and production HTML rendering',async()=>{
  const f=await fixture(),plan=f.save('## Synthetic resources\nRead current utilization and capacity.'),mcp=new LocalMcpServer(f.operations,0,f.applications,undefined,f.inspections);cleanup.push(()=>mcp.stop());const endpoint=(await mcp.start()).url!
  const client=new Client({name:'Synthetic dashboard client',version:'1'});cleanup.push(()=>client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:`Bearer ${f.profile.token}`}}}))
  const unpack=(r:unknown)=>JSON.parse((r as {content:{text:string}[]}).content[0].text)
  const fetched=unpack(await client.callTool({name:'get_inspection_plan',arguments:{serverId:f.server.id}}));expect(fetched.reportingGuidance).toContain('Dashboard report submission')
  const startedAt=Date.now(),operation=unpack(await client.callTool({name:'start_command',arguments:{serverId:f.server.id,requestKey:'synthetic-dashboard-sample',command:'synthetic dashboard samples',cwd:'/'}}))
  f.operations.decide({id:operation.id,approve:true});await vi.waitFor(()=>expect(f.operations.get(operation.id).state).toBe('succeeded'))
  const output=unpack(await client.callTool({name:'read_output',arguments:{id:operation.id,cursor:0}})),sample=JSON.parse(output.chunks.map((c:{text:string})=>c.text).join('').trim()),observedAt=f.operations.get(operation.id).updatedAt
  const result=unpack(await client.callTool({name:'submit_inspection_report',arguments:{...f.input(plan),requestKey:'synthetic-live-dashboard-report',startedAt,finishedAt:Date.now(),summary:'Synthetic actual loopback resource samples',items:[{checkId:plan.checks[0].id,status:'normal',section:'system',finding:'Synthetic current samples collected',operationIds:[operation.id],metrics:[{kind:'cpu',usagePercent:sample.cpu,observedAt,operationId:operation.id},{kind:'memory',usedBytes:sample.memoryUsed,totalBytes:sample.memoryTotal,observedAt,operationId:operation.id},{kind:'disk',mount:'/synthetic',usedBytes:sample.diskUsed,totalBytes:sample.diskTotal,observedAt,operationId:operation.id}]}]}}))
  expect(result.status).toBe('normal');const report=f.inspections.report({serverId:f.server.id,id:result.id}),html=reportHtml({serverName:'Synthetic dashboard target',report})
  expect(report.items[0].metrics).toHaveLength(3);expect(html).toContain('21.5');expect(html).toContain('4 KiB');expect(html).toContain('/synthetic');expect(f.remote.sessions).toBe(1)
  expect(readFileSync(join(f.dir,'assets.sqlite')).includes(Buffer.from('Synthetic actual loopback resource samples'))).toBe(false)
 })
 it('backs up the current handbook, remaps application references on restore and excludes report history',async()=>{
  const f=await fixture(),target=await fixture(),app=f.applications.save({serverId:f.server.id,revision:0,name:'Synthetic app',aliases:[],description:'',environment:'',deploymentPath:'/srv/fixture',runtime:'unknown',runtimeTarget:'',logSources:[]})
  const w=f.inspections.workspace(f.server.id),plan=f.inspections.save({serverId:f.server.id,serverRevision:w.serverRevision,contextDigest:w.contextDigest,revision:0,title:'Portable plan',markdown:`## App health\n{{application:${app.id}}}`,applicationIds:[app.id]})
  f.inspections.submit(f.profile.profile.id,f.input(plan))
  const backup=new BackupService(f.servers,f.operations),restore=new BackupService(target.servers,target.operations);cleanup.push(()=>{backup.close();restore.close()})
  const path=join(f.dir,'inspection.hhbackup');await backup.export(path,'1',()=>{});const preview=await restore.preview(path,'1',()=>{});await restore.commit({sessionId:preview.sessionId,servers:preview.items.filter(i=>i.kind==='server').map(i=>i.id),credentials:preview.items.filter(i=>i.kind==='credential').map(i=>i.id)},()=>{})
  const server=target.servers.listServers().find(s=>s.name===f.server.name&&s.id!==target.server.id)!,restored=target.inspections.workspace(server.id).plan!,apps=target.applications.list(server.id)
  expect(restored.markdown).toContain(`{{application:${apps[0].id}}}`);expect(restored.applicationIds).toEqual([apps[0].id]);expect(restored.stale).toBe(true);expect(target.inspections.reports({serverId:server.id}).total).toBe(0)
  const again=await restore.preview(path,'1',()=>{});expect(again.items.find(i=>i.kind==='server')?.status).toBe('duplicate')
 })
})
