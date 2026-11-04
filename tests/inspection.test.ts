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
 const remote=await sshFixture({exec:(command,stream)=>{const marker=command.match(/[a-f0-9]{48}/)![0];stream.write(`${marker}\0/fixture\0synthetic health result\n`);setTimeout(()=>{stream.exit(command.includes('synthetic failure')?5:0);stream.end()},5)}});cleanup.push(()=>remote.close())
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
