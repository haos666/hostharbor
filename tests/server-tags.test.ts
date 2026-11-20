import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { ServerTagsService, serverTagsKey } from '../src/core/servers/tags'
import { OperationService } from '../src/core/operations/service'

const services:ServerService[]=[]
afterEach(()=>{for(const s of services.splice(0))s.close()})
function fixture(){const servers=new ServerService(new Store(':memory:'));services.push(servers);servers.unlock(randomBytes(32));const credential=servers.saveCredential({name:'synthetic-password',kind:'password',password:'test-password'});const server=servers.saveServer({name:'synthetic-one',host:'one.invalid',port:22,username:'test-user',credentialId:credential.id});const other=servers.saveServer({name:'synthetic-two',host:'two.invalid',port:22,username:'test-user',credentialId:credential.id});return {servers,server,other,tags:new ServerTagsService(servers)}}
const tag=()=>({id:randomUUID(),name:'Synthetic group',color:'#6BA9EF'})
describe('server classification',()=>{
 it('persists encrypted shared tags without invalidating connections or server revisions',()=>{const f=fixture(),t=tag();let changed=0;f.servers.invalidated.add(()=>changed++);const result=f.tags.save({revision:0,tags:[t],assignments:{[f.server.id]:[t.id],[f.other.id]:[t.id]}});expect(result.revision).toBe(1);expect(result.tags[0].color).toBe('#6ba9ef');expect(f.servers.store.getServer(f.server.id)?.revision).toBe(1);expect(changed).toBe(0);const raw=f.servers.store.db.prepare('SELECT value FROM metadata WHERE key=?').get(serverTagsKey)!.value as Uint8Array;expect(Buffer.from(raw).includes(Buffer.from(t.name))).toBe(false);expect(new ServerTagsService(f.servers).get()).toEqual(result);f.servers.lock();expect(()=>f.tags.get()).toThrow();expect(()=>f.tags.save(result)).toThrow()})
 it('rejects stale revisions, duplicate names, invalid colors, missing servers and bad references',()=>{const f=fixture(),t=tag(),state={revision:0,tags:[t],assignments:{[f.server.id]:[t.id]}};f.tags.save(state);expect(()=>f.tags.save(state)).toThrow(expect.objectContaining({code:'TAGS_CHANGED'}));for(const invalid of [{tags:[t,{...t,id:randomUUID(),name:' synthetic GROUP '}]},{tags:[{...t,color:'red'}]},{assignments:{[randomUUID()]:[t.id]}},{assignments:{[f.server.id]:[randomUUID()]}},{assignments:{[f.server.id]:[t.id,t.id]}}])expect(()=>f.tags.save({...state,revision:1,...invalid})).toThrow();expect(f.tags.get().revision).toBe(1)})
 it('supports old catalogs, persists four quick tabs and rejects a fifth without changing authorization or data',()=>{
  const f=fixture(),tags=Array.from({length:5},(_,i)=>({...tag(),name:`Synthetic tab ${i+1}`,pinned:i<4}))
  const old=f.tags.save({revision:0,tags:[tag()],assignments:{}});expect(old.tags[0].pinned).toBeUndefined()
  const state=f.tags.save({...old,tags});expect(new ServerTagsService(f.servers).get().tags.filter(t=>t.pinned)).toHaveLength(4)
  expect(()=>f.tags.save({...state,tags:tags.map(t=>({...t,pinned:true}))})).toThrow(expect.objectContaining({code:'INVALID_INPUT'}))
  expect(f.tags.get()).toEqual(state)
  const switched=f.tags.save({...state,tags:state.tags.map((t,i)=>({...t,pinned:i>0}))});expect(switched.tags.filter(t=>t.pinned)).toHaveLength(4)
  expect(f.servers.store.getServer(f.server.id)?.revision).toBe(f.server.revision)
 })
 it('restores new tab preferences up to four while preserving existing same-name preferences',()=>{
  const f=fixture(),local=Array.from({length:3},(_,i)=>({...tag(),name:`Local synthetic ${i}`,pinned:true}))
  f.tags.save({revision:0,tags:local,assignments:{}})
  const incoming=[{...local[0],id:randomUUID(),pinned:false},...Array.from({length:4},(_,i)=>({...tag(),name:`Incoming synthetic ${i}`,pinned:true}))]
  f.tags.restore({revision:0,tags:incoming,assignments:{}},new Map())
  const result=f.tags.get();expect(result.tags.filter(t=>t.pinned)).toHaveLength(4)
  expect(result.tags.find(t=>t.id===local[0].id)?.pinned).toBe(true)
  expect(result.tags.filter(t=>t.name.startsWith('Incoming'))).toHaveLength(4)
 })
 it('renames and deletes shared labels, filters deleted server references and scopes MCP metadata',()=>{const f=fixture(),t=tag();let s=f.tags.save({revision:0,tags:[t],assignments:{[f.server.id]:[t.id],[f.other.id]:[t.id]}});s=f.tags.save({...s,tags:[{...t,name:'Renamed synthetic'}]});const ops=new OperationService(f.servers);try{const profile=ops.createProfile({name:'synthetic-access',serverIds:[f.server.id],mode:'policy',expiresAt:null});expect(ops.listServers(profile.profile.id)).toHaveLength(1);expect(ops.listServers(profile.profile.id)[0].tags).toEqual([{name:'Renamed synthetic',color:'#6ba9ef'}])}finally{ops.close()}f.servers.deleteServer(f.other.id);expect(f.tags.get().assignments[f.other.id]).toBeUndefined();s=f.tags.get();f.tags.save({...s,tags:[],assignments:{}});expect(f.tags.get().tags).toEqual([])})
})
