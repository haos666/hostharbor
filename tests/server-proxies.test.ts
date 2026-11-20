import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { OperationService } from '../src/core/operations/service'
const services:ServerService[]=[]
afterEach(()=>{for(const s of services.splice(0))s.close()})
function fixture(){const service=new ServerService(new Store(':memory:'));services.push(service);service.unlock(randomBytes(32));const c=service.saveCredential({name:'Synthetic password',kind:'password',password:'synthetic-password'});return {service,c}}
const route={type:'socks5' as const,host:'proxy.invalid',port:1080,authentication:{type:'none' as const}}
describe('shared SOCKS5 proxies',()=>{
 it('updates all referenced snapshots and revisions, leaves direct servers unchanged, rejects stale edits and in-use deletion',()=>{
  const {service,c}=fixture(),p=service.saveProxy({name:'Synthetic proxy',route})
  const save=(name:string,shared=true)=>service.saveServer({name,host:name+'.invalid',port:22,username:'synthetic',credentialId:c.id,route:shared?{...route,proxyId:p.id}:{type:'direct'}})
  const a=save('synthetic-a'),b=save('synthetic-b'),direct=save('synthetic-direct',false)
  service.store.db.prepare('INSERT INTO known_hosts(host,port,key,fingerprint,confirmedAt) VALUES(?,?,?,?,?)').run(a.host,22,Buffer.from('synthetic-key'),'synthetic',Date.now())
  const ops=new OperationService(service)
  try{
   const before=ops.snapshot(a.id).snapshot
   let invalidated=0;service.invalidated.add(()=>invalidated++)
   const updated=service.saveProxy({...p,route:{...route,host:'changed.invalid',port:1081}})
   expect(updated.revision).toBe(2);expect(invalidated).toBe(1)
   for(const s of [a,b])expect(service.store.getServer(s.id)).toMatchObject({revision:s.revision+1,route:{host:'changed.invalid',port:1081,proxyId:p.id}})
   expect(service.store.getServer(direct.id)?.revision).toBe(direct.revision)
   expect(ops.snapshot(a.id).snapshot).not.toBe(before)
   expect(()=>service.saveProxy({...p,name:'Stale'})).toThrow(expect.objectContaining({code:'PROXY_CHANGED'}))
   expect(()=>service.deleteProxy({id:p.id,revision:2})).toThrow(expect.objectContaining({code:'PROXY_IN_USE'}))
   // Old renderer snapshots never overwrite the shared endpoint.
   const {revision:_revision,createdAt:_createdAt,...input}=a;const saved=service.saveServer(input);expect(saved.route).toMatchObject({host:'changed.invalid',port:1081})
  }finally{ops.close()}
 })
 it('migrates inline routes once, deduplicates and persists encrypted catalog and refuses access when locked',()=>{
  const {service,c}=fixture()
  for(const name of ['synthetic-a','synthetic-b'])service.saveServer({name,host:name+'.invalid',port:22,username:'synthetic',credentialId:c.id,route})
  const list=service.migrateProxies();expect(list).toHaveLength(1)
  expect(new Set(service.listServers().map(s=>s.route.type==='socks5'?s.route.proxyId:undefined)).size).toBe(1)
  const revisions=service.listServers().map(s=>s.revision);expect(service.migrateProxies()).toEqual(list);expect(service.listServers().map(s=>s.revision)).toEqual(revisions)
  const raw=service.store.db.prepare('SELECT value FROM metadata WHERE key=?').get('socks-proxies:v1')!.value as Uint8Array
  expect(Buffer.from(raw).includes(Buffer.from('proxy.invalid'))).toBe(false)
  service.lock();expect(()=>service.listProxies()).toThrow(expect.objectContaining({code:'VAULT_LOCKED'}));expect(()=>service.saveProxy({name:'Locked',route})).toThrow()
 })
 it('guards password credentials, duplicate names and validates references before mutation',()=>{
  const {service,c}=fixture(),p=service.saveProxy({name:'Synthetic proxy',route:{...route,authentication:{type:'password',username:'synthetic',credentialId:c.id}}})
  expect(()=>service.deleteCredential(c.id)).toThrow(expect.objectContaining({code:'CREDENTIAL_IN_USE'}))
  expect(()=>service.saveProxy({name:'synthetic PROXY',route})).toThrow(expect.objectContaining({code:'PROXY_DUPLICATE'}))
  expect(()=>service.saveProxy({...p,route:{...route,authentication:{type:'password',username:'synthetic',credentialId:p.id}}})).toThrow(expect.objectContaining({code:'PROXY_CREDENTIAL'}))
  service.deleteProxy({id:p.id,revision:p.revision});expect(service.listProxies()).toEqual([])
  expect(()=>service.saveServer({name:'Synthetic',host:'synthetic.invalid',port:22,username:'synthetic',credentialId:c.id,route:{...route,proxyId:p.id}})).toThrow(expect.objectContaining({code:'PROXY_CHANGED'}))
 })
 it('rolls back both catalog and all route changes when storage fails',()=>{
  const {service,c}=fixture(),p=service.saveProxy({name:'Synthetic proxy',route})
  const s=service.saveServer({name:'Synthetic',host:'synthetic.invalid',port:22,username:'synthetic',credentialId:c.id,route:{...route,proxyId:p.id}})
  service.store.db.exec("CREATE TRIGGER synthetic_fail BEFORE UPDATE ON servers BEGIN SELECT RAISE(ABORT,'synthetic'); END")
  expect(()=>service.saveProxy({...p,route:{...route,port:1090}})).toThrow()
  expect(service.listProxies()).toEqual([p]);expect(service.store.getServer(s.id)).toEqual(s)
 })
})
