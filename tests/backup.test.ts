import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes, createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { ServerService } from '../src/core/servers/service'
import { Store } from '../src/core/storage/database'
import { OperationService } from '../src/core/operations/service'
import { DesktopSession } from '../src/core/security/desktop-session'
import { BackupService } from '../src/core/backup/service'
import { decryptBackup, encryptBackup, maxBackupBytes } from '../src/core/backup/envelope'
import { validatePortable } from '../src/core/backup/schema'
import { utils } from 'ssh2'
import { DesktopBackup } from '../src/main/backup'
import { fixtureReport } from './helpers/investigation'
import { sshFixture } from './helpers/routes'
import type { BackupPreview } from '../src/shared/backup'
import { FileService } from '../src/core/files/service'

const directories:string[]=[],instances:{ backup:BackupService;ops:OperationService;servers:ServerService }[]=[]
afterEach(()=>{for(const i of instances.splice(0)){i.backup.close();i.ops.close();i.servers.close()}for(const d of directories.splice(0))rmSync(d,{recursive:true,force:true})})
function fixture(){const dir=mkdtempSync(join(tmpdir(),'hostharbor-backup-'));directories.push(dir);const servers=new ServerService(new Store(join(dir,'data.sqlite'))),key=randomBytes(32);servers.unlock(key);const ops=new OperationService(servers),desktop=new DesktopSession(dir,servers);desktop.unlock(key,true);const backup=new BackupService(servers,ops);instances.push({backup,ops,servers});return {dir,servers,ops,backup,desktop,key,guard:()=>desktop.assertOpen(),file:join(dir,'assets.hhbackup')}}
function seed(f:ReturnType<typeof fixture>){
 const credential=f.servers.saveCredential({name:'fixture-password',kind:'password',password:'synthetic-backup-password'})
 const jump=f.servers.saveServer({name:'fixture-jump',host:'jump.invalid',port:22,username:'fixture-user',credentialId:credential.id})
 const server=f.servers.saveServer({name:'fixture-host-a',host:'target.invalid',port:22,username:'fixture-user',credentialId:credential.id,route:{type:'ssh-jump',serverId:jump.id},elevation:{type:'sudo',passwordSource:'login'}})
 return {credential,jump,server}
}
const selection=(p:BackupPreview)=>({sessionId:p.sessionId,credentials:p.items.filter(i=>i.kind==='credential'&&i.status!=='duplicate'&&i.status!=='blocked').map(i=>i.id),servers:p.items.filter(i=>i.kind==='server'&&i.status!=='duplicate'&&i.status!=='blocked').map(i=>i.id)})
async function exported(){const source=fixture(),assets=seed(source);await source.backup.export(source.file,'1',source.guard);return {source,...assets}}

describe('portable encrypted assets',()=>{
 it('supports a one-character password, independent random envelopes and authenticated failure',async()=>{
  const plain=Buffer.from('synthetic-backup-content'),a=await encryptBackup(plain,'1'),b=await encryptBackup(plain,'1')
  expect(a.equals(b)).toBe(false);expect(a.includes(plain)).toBe(false);expect((await decryptBackup(a,'1')).equals(plain)).toBe(true)
  await expect(decryptBackup(a,'wrong')).rejects.toMatchObject({code:'BACKUP_INVALID'})
  for(const index of [0,8,12,a.length-1]){const changed=Buffer.from(a);changed[index]^=1;await expect(decryptBackup(changed,'1')).rejects.toMatchObject({code:'BACKUP_INVALID'})}
  await expect(decryptBackup(a.subarray(0,20),'1')).rejects.toMatchObject({code:'BACKUP_INVALID'})
  await expect(encryptBackup(plain,'')).rejects.toMatchObject({code:'BACKUP_PASSWORD'})
  await expect(decryptBackup(Buffer.alloc(maxBackupBytes+1),'1')).rejects.toMatchObject({code:'BACKUP_LIMIT'})
 })
 it('restores on another master key, remaps bindings, excludes grants and deduplicates repeated import',async()=>{
  const {source}=await exported(),target=fixture()
  source.ops.createProfile({name:'fixture-client',serverIds:source.servers.listServers().map(s=>s.id),mode:'policy',expiresAt:null})
  await source.backup.export(source.file,'1',source.guard)
  const portable=JSON.parse((await decryptBackup(readFileSync(source.file),'1')).toString())
  expect(Object.keys(portable).sort()).toEqual(['createdAt','credentials','hosts','servers','version'])
  const preview=await target.backup.preview(source.file,'1',target.guard)
  expect(JSON.stringify(preview)).not.toContain('synthetic-backup-password')
  expect(preview.counts).toMatchObject({servers:2,credentials:1})
  expect(target.servers.listServers()).toHaveLength(0)
  const result=await target.backup.commit(selection(preview),target.guard)
  expect(result).toMatchObject({servers:2,credentials:1})
  const servers=target.servers.listServers(),jump=servers.find(s=>s.name==='fixture-jump')!,server=servers.find(s=>s.name==='fixture-host-a')!
  expect(server.route).toEqual({type:'ssh-jump',serverId:jump.id});expect(server.credentialId).toBe(jump.credentialId)
  expect(target.servers.credentialForBackup(server.credentialId!).kind).toBe('password')
  expect(target.ops.listProfiles()).toHaveLength(0)
  expect(target.servers.store.getCredential(server.credentialId!)!.secret).not.toEqual(source.servers.store.listCredentials().map(c=>source.servers.store.getCredential(c.id)!.secret)[0])
  const repeat=await target.backup.preview(source.file,'1',target.guard);expect(repeat.items.every(i=>i.status==='duplicate')).toBe(true)
  await expect(target.backup.commit(selection(preview),target.guard)).rejects.toMatchObject({code:'BACKUP_SESSION'})
 })
 it('restores private key contents and passphrase without original key paths',async()=>{
  const source=fixture(),target=fixture(),pair=utils.generateKeyPairSync('ecdsa',{bits:256,cipher:'aes256-cbc',passphrase:'synthetic-passphrase',rounds:16})
  source.servers.saveCredential({kind:'private-key',name:'fixture-key',privateKey:pair.private,passphrase:'synthetic-passphrase'})
  await source.backup.export(source.file,'p',source.guard)
  const p=await target.backup.preview(source.file,'p',target.guard);await target.backup.commit(selection(p),target.guard)
  expect(target.servers.credentialForBackup(target.servers.listCredentials()[0].id)).toMatchObject({privateKey:pair.private,passphrase:'synthetic-passphrase'})
 })
 it('remaps independent SOCKS and elevation passwords without granting execution',async()=>{
  const source=fixture(),target=fixture(),{credential}=seed(source)
  const proxy=source.servers.saveCredential({name:'fixture-proxy-password',kind:'password',password:'synthetic-proxy-password'})
  const elevation=source.servers.saveCredential({name:'fixture-sudo-password',kind:'password',password:'synthetic-sudo-password'})
  source.servers.saveServer({name:'fixture-proxied',host:'proxy-target.invalid',port:22,username:'fixture-user',credentialId:credential.id,route:{type:'socks5',host:'proxy.invalid',port:1080,authentication:{type:'password',username:'fixture-proxy-user',credentialId:proxy.id}},elevation:{type:'sudo',passwordSource:'credential',credentialId:elevation.id}})
  await source.backup.export(source.file,'p',source.guard)
  const p=await target.backup.preview(source.file,'p',target.guard);await target.backup.commit(selection(p),target.guard)
  const saved=target.servers.listServers().find(s=>s.name==='fixture-proxied')!
  expect(saved.route.type).toBe('socks5');expect(saved.elevation?.type).toBe('sudo')
  if(saved.route.type!=='socks5'||saved.route.authentication.type!=='password'||saved.elevation?.type!=='sudo')throw Error('fixture')
  expect(target.servers.credentialForBackup(saved.route.authentication.credentialId)).toMatchObject({password:'synthetic-proxy-password'})
  expect(target.servers.credentialForBackup(saved.elevation.credentialId!)).toMatchObject({password:'synthetic-sudo-password'})
  expect(target.ops.listProfiles()).toEqual([])
 })
 it('cancels an export after locking without replacing the existing destination',async()=>{
  const source=fixture();seed(source);writeFileSync(source.file,'synthetic-existing-backup')
  const exporting=source.backup.export(source.file,'p',source.guard)
  source.desktop.lock()
  await expect(exporting).rejects.toMatchObject({code:'VAULT_LOCKED'})
  expect(readFileSync(source.file,'utf8')).toBe('synthetic-existing-backup')
  expect(readdirSync(source.dir).some(n=>n.endsWith('.tmp'))).toBe(false)
 })
 it('handles unwritable destinations and native picker cancellation without starting writes',async()=>{
  const source=fixture();seed(source)
  await expect(source.backup.export(join(source.dir,'missing','fixture.hhbackup'),'p',source.guard)).rejects.toMatchObject({code:'STORAGE_FAILED'})
  expect(readdirSync(source.dir).some(n=>n.endsWith('.tmp'))).toBe(false)
  const calls:string[]=[],bridge=new DesktopBackup({async call<T>(method:string):Promise<T>{calls.push(method);return {vault:'unlocked'} as T}},()=>0,{open:async()=>null,save:async()=>null})
  expect(await bridge.export('1')).toBeNull();expect(await bridge.choose()).toBeNull()
  expect(calls).not.toContain('exportBackup');expect(calls).not.toContain('previewBackup')
 })
 it('imports a saved credential and host key usable in a real synthetic SSH connection',async()=>{
  const remote=await sshFixture({username:'synthetic-route-user',password:'synthetic-route-password'});const source=fixture(),target=fixture()
  try{
   const credential=source.servers.saveCredential({kind:'password',name:'fixture-login',password:'synthetic-route-password'})
   const server=source.servers.saveServer({name:'fixture-host-a',host:'127.0.0.1',port:remote.port,username:'synthetic-route-user',credentialId:credential.id})
   const test=await source.servers.testConnection(server.id);expect(test.status).toBe('host-key-required');if(test.status!=='host-key-required')throw Error('fixture');source.servers.trustHost(test.challengeId)
   await source.backup.export(source.file,'p',source.guard);const p=await target.backup.preview(source.file,'p',target.guard);await target.backup.commit(selection(p),target.guard)
   expect((await target.servers.testConnection(target.servers.listServers()[0].id)).status).toBe('connected')
  }finally{await remote.close()}
 })
 it('reports same-name conflicts without overwriting and requires selected dependencies',async()=>{
  const {source}=await exported(),target=fixture();target.servers.saveCredential({name:'fixture-password',kind:'password',password:'different-synthetic-password'})
  const p=await target.backup.preview(source.file,'1',target.guard);expect(p.items.find(i=>i.kind==='credential')!.status).toBe('conflict')
  const s=selection(p);await expect(target.backup.commit({...s,credentials:[]},target.guard)).rejects.toMatchObject({code:'BACKUP_DEPENDENCY'})
  expect(target.servers.listServers()).toHaveLength(0);expect(target.servers.listCredentials()).toHaveLength(1)
  const p2=await target.backup.preview(source.file,'1',target.guard);await target.backup.commit(selection(p2),target.guard)
  expect(target.servers.listCredentials()).toHaveLength(2)
 })
 it('blocks conflicting host fingerprints and their jump dependents',async()=>{
  const {source,jump}=await exported(),target=fixture()
  const parsed=utils.parseKey(utils.generateKeyPairSync('ecdsa',{bits:256}).private);if(parsed instanceof Error||Array.isArray(parsed))throw Error('fixture');const publicKey=parsed.getPublicSSH(),fingerprint=`SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/,'')}`
  // Use ssh2 public wire bytes from a synthetic fixture key.
  const remote=await sshFixture({username:'synthetic-route-user',password:'synthetic-route-password'})
  try{
   const cred=source.servers.saveCredential({kind:'password',name:'fixture-temp',password:'synthetic-route-password'})
   const server=source.servers.saveServer({name:'fixture-temp',host:'127.0.0.1',port:remote.port,username:'synthetic-route-user',credentialId:cred.id})
   const test=await source.servers.testConnection(server.id);if(test.status!=='host-key-required')throw Error('fixture');source.servers.trustHost(test.challengeId)
   const known=source.servers.store.getHost('127.0.0.1',remote.port)!
   source.servers.store.db.prepare('INSERT INTO known_hosts(host,port,key,fingerprint,confirmedAt) VALUES(?,?,?,?,?)').run(jump.host,jump.port,known.key,known.fingerprint,Date.now())
   target.servers.store.db.prepare('INSERT INTO known_hosts(host,port,key,fingerprint,confirmedAt) VALUES(?,?,?,?,?)').run(jump.host,jump.port,publicKey,fingerprint,Date.now())
   await source.backup.export(source.file,'1',source.guard)
   const p=await target.backup.preview(source.file,'1',target.guard)
   expect(p.items.find(i=>i.name==='fixture-jump')?.reason).toBe('host-key');expect(p.items.find(i=>i.name==='fixture-host-a')?.reason).toBe('dependency')
   expect(target.servers.store.getHost(jump.host,jump.port)!.fingerprint).toBe(fingerprint)
  }finally{await remote.close()}
 })
 it('restores dossier corrections, applications and file settings without raw evidence output',async()=>{
  const source=fixture(),target=fixture(),{server}=seed(source),report=fixtureReport('33333333-3333-4333-8333-333333333333')
  const content={...report,overview:'fixture-dossier'}
  const view={run:{state:'analyzing',evidence:[{preview:'synthetic-private-output'}]},report:{runId:'11111111-1111-4111-8111-111111111111',serverRevision:server.revision,collectedAt:123,model:'fixture-model',content,evidence:[{preview:'synthetic-private-output'}]},corrections:{revision:1,updatedAt:124,values:{overview:'fixture-correction'}}}
  const data=Buffer.from(JSON.stringify(view));source.servers.store.db.prepare('INSERT INTO server_dossiers(serverId,detail) VALUES(?,?)').run(server.id,source.servers.protect(`server-dossier:${server.id}`,data))
  const app={schemaVersion:1,id:'22222222-2222-4222-8222-222222222222',serverId:server.id,serverRevision:server.revision,revision:1,name:'fixture-app',aliases:[],description:'',environment:'',deploymentPath:'/srv/fixture-app',runtime:'systemd',runtimeTarget:'fixture.service',logSources:[],ports:[],createdAt:123,updatedAt:123,confirmedAt:123}
  source.servers.store.db.prepare('INSERT INTO applications(id,serverId,createdAt,detail) VALUES(?,?,?,?)').run(app.id,server.id,123,source.servers.protect(`application:${app.id}`,Buffer.from(JSON.stringify(app))))
  const profile=source.ops.createProfile({name:'fixture-files',serverIds:[server.id],mode:'policy',expiresAt:null}).profile
  const files=new FileService(source.ops);files.save({...files.access(profile.id,server.id),profileId:profile.id,uploadEnabled:true,uploadDirectory:'/srv/upload'})
  await source.backup.export(source.file,'p',source.guard)
  const plain=await decryptBackup(readFileSync(source.file),'p');expect(plain.toString()).not.toContain('synthetic-private-output');plain.fill(0)
  const p=await target.backup.preview(source.file,'p',target.guard);expect(p.counts).toMatchObject({dossiers:1,applications:1,fileSettings:1});await target.backup.commit(selection(p),target.guard)
  const id=target.servers.listServers().find(s=>s.name==='fixture-host-a')!.id,row=target.servers.store.db.prepare('SELECT detail FROM server_dossiers WHERE serverId=?').get(id)!
  const restored=JSON.parse(target.servers.reveal(`server-dossier:${id}`,row.detail as Uint8Array).toString())
  expect(restored.run).toBeNull();expect(restored.report.evidence).toEqual([]);expect(restored.corrections.values.overview).toBe('fixture-correction');expect(restored.report.snapshot).toBe('restored-backup')
  const repeat=await target.backup.preview(source.file,'p',target.guard);expect(repeat.items.every(i=>i.status==='duplicate')).toBe(true)
 })
 it.each(['file','asset','lock','expire'] as const)('rejects stale preview after %s changes',async kind=>{
  const {source}=await exported(),target=fixture(),revision=target.desktop.revision,guard=()=>target.desktop.assertRevision(revision)
  const p=await target.backup.preview(source.file,'1',guard)
  if(kind==='file')writeFileSync(source.file,Buffer.from('synthetic-changed-file'))
  if(kind==='asset')target.servers.saveCredential({name:'fixture-other',kind:'password',password:'other'})
  if(kind==='lock')target.desktop.lock()
  if(kind==='expire'){const real=Date.now;Date.now=()=>p.expiresAt+1;try{await expect(target.backup.commit(selection(p),guard)).rejects.toMatchObject({code:'BACKUP_SESSION'})}finally{Date.now=real}return}
  await expect(target.backup.commit(selection(p),guard)).rejects.toBeDefined();expect(target.servers.store.listServers()).toHaveLength(0)
 })
 it('rolls back all imported records if a write fails halfway',async()=>{
  const {source}=await exported(),target=fixture(),p=await target.backup.preview(source.file,'1',target.guard)
  target.servers.store.db.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON servers BEGIN SELECT RAISE(ABORT,'synthetic transaction fault'); END")
  await expect(target.backup.commit(selection(p),target.guard)).rejects.toBeDefined();expect(target.servers.listCredentials()).toHaveLength(0);expect(target.servers.listServers()).toHaveLength(0)
 })
 it('requires idle operations and leaves existing assets intact',async()=>{
  const {source}=await exported(),target=fixture(),assets=seed(target)
  const wire=utils.parseKey(utils.generateKeyPairSync('ecdsa',{bits:256}).private);if(wire instanceof Error||Array.isArray(wire))throw Error('fixture');for(const server of target.servers.listServers()){const bytes=wire.getPublicSSH();target.servers.store.db.prepare('INSERT INTO known_hosts(host,port,key,fingerprint,confirmedAt) VALUES(?,?,?,?,?)').run(server.host,server.port,bytes,`SHA256:${createHash('sha256').update(bytes).digest('base64').replace(/=+$/,'')}`,Date.now())}
  const profile=target.ops.createProfile({name:'fixture-client',serverIds:[assets.server.id],mode:'policy',expiresAt:null}).profile
  await target.ops.start(profile.id,{serverId:assets.server.id,requestKey:'fixture-pending',command:'pwd',cwd:'/',timeoutMs:1000,connectTimeoutMs:1000})
  const p=await target.backup.preview(source.file,'1',target.guard)
  await expect(target.backup.commit({...selection(p),credentials:[p.items.find(i=>i.kind==='credential')!.id]},target.guard)).rejects.toMatchObject({code:'STORAGE_BUSY'})
 })
 it('rejects malformed references and never leaves an unencrypted temporary export',async()=>{
  const {source}=await exported(),data=validatePortable(JSON.parse((await decryptBackup(readFileSync(source.file),'1')).toString()))
  const bad=structuredClone(data);bad.servers[0].credentialId='99999999-9999-4999-8999-999999999999';expect(()=>validatePortable(bad)).toThrow()
  const unknown={...data,token:'synthetic-not-permitted'};expect(()=>validatePortable(unknown)).toThrow()
  expect(readdirSync(source.dir).some(n=>n.endsWith('.tmp'))).toBe(false)
  expect(readFileSync(source.file).includes(Buffer.from('fixture-host-a'))).toBe(false)
  const link=join(source.dir,'link.hhbackup');symlinkSync(source.file,link);await expect(source.backup.preview(link,'1',source.guard)).rejects.toMatchObject({code:'BACKUP_INVALID'})
 })
})

describe('desktop file selection boundary',()=>{
 it('accepts only opaque native selections and rejects background-unlocked sessions',async()=>{
  let revision=0,locked=false;const calls:{method:string;payload:unknown}[]=[]
  const core={async call<T>(method:string,payload?:unknown):Promise<T>{calls.push({method,payload});return (method==='status'?{vault:locked?'locked':'unlocked'}:method==='previewBackup'?{sessionId:'fixture-preview'}:undefined) as T}}
  const bridge=new DesktopBackup(core,()=>revision,{open:async()=>'/synthetic/fixture.hhbackup',save:async()=>null})
  const file=await bridge.choose();expect(file).toMatchObject({name:'fixture.hhbackup'});expect(JSON.stringify(file)).not.toContain('/synthetic/')
  await expect(bridge.preview({fileId:'/arbitrary/path',password:'p'})).rejects.toMatchObject({code:'BACKUP_SESSION'})
  await bridge.preview({fileId:file!.id,password:'p'});expect(calls.at(-1)).toEqual({method:'previewBackup',payload:{path:'/synthetic/fixture.hhbackup',password:'p'}})
  revision++;await expect(bridge.preview({fileId:file!.id,password:'p'})).rejects.toMatchObject({code:'BACKUP_SESSION'})
  locked=true;await expect(bridge.export('p')).rejects.toMatchObject({code:'VAULT_LOCKED'})
 })
})
