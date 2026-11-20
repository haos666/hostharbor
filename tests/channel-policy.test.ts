import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { OperationService } from '../src/core/operations/service'
import { PolicyService } from '../src/core/policy/service'
import { FileService } from '../src/core/files/service'
import type { ApprovalPolicy } from '../src/shared/contracts'
import { sshFixture } from './helpers/routes'
const cleanup:(()=>unknown|Promise<unknown>)[]=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close()})
async function fixture(){
 const remote=await sshFixture();cleanup.push(()=>remote.close())
 const servers=new ServerService(new Store(':memory:'));servers.unlock(randomBytes(32));const credential=servers.saveCredential({kind:'password',name:'Synthetic channel login',password:'target-secret'})
 const server=servers.saveServer({name:'Synthetic channel server',host:'127.0.0.1',port:remote.port,username:'target-user',credentialId:credential.id})
 const challenge=await servers.testConnection(server.id);if(challenge.status!=='host-key-required')throw Error('Synthetic pin');servers.trustHost(challenge.challengeId)
 const operations=new OperationService(servers),files=new FileService(operations);cleanup.push(()=>{operations.close();servers.close()})
 const create=()=>operations.createProfile({name:'Synthetic channel',serverIds:[server.id],mode:'policy',expiresAt:null})
 const a=create(),b=create()
 const save=(id:string,patch:Partial<ApprovalPolicy>={})=>{const c=operations.policy.channel(id);return operations.policy.saveChannel({profileId:id,revision:c.revision,policy:{...c.policy??c.defaultPolicy,...patch,revision:c.revision},permissiveConfirmed:true})}
 const start=(id:string)=>operations.start(id,{serverId:server.id,requestKey:randomUUID(),command:'pwd',cwd:'/',timeoutMs:1000,connectTimeoutMs:1000})
 const preview=(id:string)=>operations.previewPolicy({profileId:id,serverId:server.id,command:'pwd',cwd:'/'})
 return {servers,server,operations,files,a,b,save,start,preview}
}
describe('channel-scoped approval policies',()=>{
 it('inherits by default, isolates overrides and resolves scope for the authenticated profile',async()=>{
  const f=await fixture();expect(f.operations.policy.channel(f.a.profile.id).policy).toBeNull()
  f.save(f.a.profile.id,{mode:'permissive'})
  expect(f.preview(f.a.profile.id)).toMatchObject({action:'allow',scope:{source:'channel',profileId:f.a.profile.id}})
  expect(f.preview(f.b.profile.id)).toMatchObject({action:'approval',scope:{source:'default'}})
  expect(f.operations.authenticate(f.a.token)).toBe(f.a.profile.id)
  expect(new PolicyService(f.servers).channel(f.a.profile.id).policy?.mode).toBe('permissive')
 })
 it('invalidates only a changed channel and leaves unrelated pending approvals intact',async()=>{
  const f=await fixture(),a=f.start(f.a.profile.id),b=f.start(f.b.profile.id);f.save(f.a.profile.id)
  expect(f.operations.get(a.id).state).toBe('interrupted');expect(f.operations.get(b.id).state).toBe('awaiting_approval')
  expect(()=>f.operations.decide({id:a.id,approve:true})).toThrow()
 })
 it('default edits affect inheritors while global pause and resume invalidate all undispatched scopes',async()=>{
  const f=await fixture();f.save(f.a.profile.id);const a=f.start(f.a.profile.id),b=f.start(f.b.profile.id)
  f.operations.policy.save({...f.operations.policy.get(),mode:'assisted'})
  expect(f.operations.get(a.id).state).toBe('awaiting_approval');expect(f.operations.get(b.id).state).toBe('interrupted')
  const before=f.preview(f.a.profile.id).scope
  f.operations.policy.save({...f.operations.policy.get(),mode:'paused'})
  expect(f.operations.get(a.id).state).toBe('interrupted');expect(f.preview(f.a.profile.id).action).toBe('deny');expect(f.files.describe(f.a.profile.id,f.server.id).downloadsPaused).toBe(true)
  f.operations.policy.save({...f.operations.policy.get(),mode:'all-approval'})
  expect(f.preview(f.a.profile.id).scope?.pauseRevision).toBeGreaterThan(before!.pauseRevision)
 })
 it('global approval controls commands and files, preserves explicit channel denial, and yields to global denial',async()=>{
  const f=await fixture();f.save(f.a.profile.id,{mode:'permissive',uploadApprovalRequired:{permissive:false},downloadApprovalRequired:{permissive:false}})
  expect(f.preview(f.a.profile.id).action).toBe('allow')
  f.operations.policy.save({...f.operations.policy.get(),forceApproval:true})
  expect(f.preview(f.a.profile.id)).toMatchObject({action:'approval',scope:{forceApproval:true}})
  expect(f.files.describe(f.a.profile.id,f.server.id)).toMatchObject({uploadRequiresApproval:true,downloadRequiresApproval:true})
  f.save(f.b.profile.id,{mode:'permissive',rules:[{id:randomUUID(),name:'Synthetic denied command',enabled:true,action:'deny',command:'pwd',cwd:null,expiresAt:null,profileIds:[],serverIds:[]}]})
  expect(f.preview(f.b.profile.id).action).toBe('deny')
  f.operations.policy.save({...f.operations.policy.get(),denyExecution:true})
  expect(f.preview(f.a.profile.id).action).toBe('deny');expect(f.files.describe(f.a.profile.id,f.server.id).uploadsPaused).toBe(true)
  f.operations.policy.save({...f.operations.policy.get(),forceApproval:false,denyExecution:false})
  expect(f.preview(f.a.profile.id).action).toBe('allow');expect(f.files.describe(f.a.profile.id,f.server.id).uploadRequiresApproval).toBe(false)
 })
 it('uses channel-specific file direction approvals without changing another channel or server settings',async()=>{
  const f=await fixture();f.save(f.a.profile.id,{uploadApprovalRequired:{'all-approval':false},downloadApprovalRequired:{'all-approval':false}})
  expect(f.files.describe(f.a.profile.id,f.server.id)).toMatchObject({uploadRequiresApproval:false,downloadRequiresApproval:false})
  expect(f.files.describe(f.b.profile.id,f.server.id)).toMatchObject({uploadRequiresApproval:true,downloadRequiresApproval:true})
  const spec={version:2 as const,request:{serverId:f.server.id,requestKey:'synthetic-transfer',direction:'download' as const,offset:0,remotePath:'/synthetic/example.log',expectedSize:10},accessRevision:0,maxBytes:500*1024*1024}
  expect(f.operations.fileAdapter!.decision(f.a.profile.id,spec)).toMatchObject({action:'allow',scope:{source:'channel'}})
  expect(f.operations.fileAdapter!.decision(f.b.profile.id,spec).action).toBe('approval')
 })
 it('retains monotonically increasing revisions on returning to inheritance and rejects stale edits',async()=>{
  const f=await fixture(),first=f.save(f.a.profile.id),second=f.operations.policy.saveChannel({profileId:f.a.profile.id,revision:first.revision,policy:null})
  expect(second.revision).toBe(first.revision+1);expect(f.preview(f.a.profile.id).scope?.source).toBe('default')
  expect(()=>f.operations.policy.saveChannel({profileId:f.a.profile.id,revision:first.revision,policy:null})).toThrow(expect.objectContaining({code:'POLICY_CONFLICT'}))
  expect(f.save(f.a.profile.id).revision).toBe(second.revision+1)
 })
 it('requires explicit permissive consent and rejects revoked, deleted, internal or locked edits',async()=>{
  const f=await fixture(),input={profileId:f.a.profile.id,revision:0,policy:{revision:0,mode:'permissive',rules:[]}}
  expect(()=>f.operations.policy.saveChannel(input)).toThrow(expect.objectContaining({code:'PERMISSIVE_CONFIRMATION'}))
  const desktop=f.operations.desktopProfile(f.server.id,'desktop-files');expect(()=>f.operations.policy.channel(desktop)).toThrow(expect.objectContaining({code:'ACCESS_DENIED'}))
  f.operations.revokeProfile(f.a.profile.id);expect(()=>f.save(f.a.profile.id)).toThrow(expect.objectContaining({code:'ACCESS_DENIED'}))
  f.operations.deleteProfile({id:f.b.profile.id,revision:f.b.profile.revision});expect(()=>f.save(f.b.profile.id)).toThrow(expect.objectContaining({code:'ACCESS_DENIED'}))
  f.servers.lock();expect(()=>f.operations.policy.channel(desktop)).toThrow(expect.objectContaining({code:'VAULT_LOCKED'}))
 })
 it('rejects rules scoped to another channel and detects corrupt saved policies',async()=>{
  const f=await fixture();expect(()=>f.save(f.a.profile.id,{mode:'assisted',rules:[{id:randomUUID(),name:'Synthetic cross scope',enabled:true,action:'allow',command:'pwd',cwd:null,expiresAt:null,serverIds:[],profileIds:[f.b.profile.id]}]})).toThrow(expect.objectContaining({code:'INVALID_INPUT'}))
  f.save(f.a.profile.id);f.servers.store.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(Buffer.from('broken'),'approval-channel:v1:'+f.a.profile.id)
  expect(()=>f.preview(f.a.profile.id)).toThrow()
 })
})
