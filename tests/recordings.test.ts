import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { RecordingStore } from '../src/core/recording/storage'
const cleanup: (()=>void)[]=[]
afterEach(()=>{vi.useRealTimers();for(const fn of cleanup.splice(0).reverse())fn()})
function fixture(disk=false){
  const directory=mkdtempSync(join(tmpdir(),'hh-recordings-'));cleanup.push(()=>rmSync(directory,{recursive:true,force:true}))
  const path=disk?join(directory,'test.sqlite'):':memory:',servers=new ServerService(new Store(path)),key=randomBytes(32)
  cleanup.push(()=>servers.close());servers.unlock(key)
  let active=0
  const recordings=new RecordingStore(servers,()=>active);cleanup.push(()=>recordings.close())
  function insert(state='succeeded',ageDays=0,storedBytes?:number){
    const id=randomUUID(),now=Date.now()-ageDays*86400000
    servers.store.db.prepare('INSERT INTO operations(id,profileId,requestKey,state,detail,createdAt,updatedAt,outputBytes) VALUES(?,?,?,?,?,?,?,?)').run(id,randomUUID(),id,state,Buffer.from('synthetic metadata'),now,now,100)
    const data=storedBytes?Buffer.alloc(storedBytes):recordings.encode(`${id}:output:0:stdout`,'synthetic output')
    servers.store.db.prepare("INSERT INTO operation_output(operationId,seq,stream,elapsedMs,data,encoding) VALUES(?,0,'stdout',100,?,'gzip-json')").run(id,data)
    return id
  }
  const has=(id:string)=>Number(servers.store.db.prepare('SELECT COUNT(*) n FROM operation_output WHERE operationId=?').get(id)!.n)>0
  return {servers,recordings,insert,has,key,path,setActive:(n:number)=>{active=n}}
}
describe('bounded recording storage and retention',()=>{
  it('defaults to seven days and only clears ended output at the cutoff, retaining operation summaries',()=>{
    const f=fixture(),old=f.insert('succeeded',8),edge=f.insert('unknown',7),fresh=f.insert('failed',6),running=f.insert('running',20)
    const empty=f.insert('denied',8);f.servers.store.db.prepare('DELETE FROM operation_output WHERE operationId=?').run(empty)
    expect(f.recordings.settings()).toEqual({revision:0,retentionDays:7,quotaMiB:500})
    f.recordings.maintain();expect(f.has(old)).toBe(false);expect(f.has(edge)).toBe(false);expect(f.has(fresh)).toBe(true);expect(f.has(running)).toBe(true)
    expect(f.recordings.stats().operationCount).toBe(5)
    expect(f.servers.store.db.prepare('SELECT replayClearedAt FROM operations WHERE id=?').get(empty)!.replayClearedAt).toBeNull()
    expect(f.servers.store.db.prepare('SELECT replayClearReason,outputBytes FROM operations WHERE id=?').get(old)).toMatchObject({replayClearReason:'expired',outputBytes:100})
  })
  it('runs background maintenance while unlocked, pauses while locked, and stops its timer on close',()=>{
    vi.useFakeTimers();const f=fixture(),id=f.insert('succeeded',8)
    f.servers.lock();vi.advanceTimersByTime(60000);expect(f.has(id)).toBe(true)
    f.servers.unlock(f.key);vi.advanceTimersByTime(60000);expect(f.has(id)).toBe(false)
    const next=f.insert('succeeded',8);f.recordings.close();vi.advanceTimersByTime(60000);expect(f.has(next)).toBe(true)
  })
  it('encrypts settings, persists changes after restart and rejects stale or invalid settings',()=>{
    const f=fixture(true),saved=f.recordings.save({revision:0,retentionDays:14,quotaMiB:128})
    expect(saved.settings.retentionDays).toBe(14)
    expect(()=>f.recordings.save({revision:0,retentionDays:1,quotaMiB:64})).toThrow(expect.objectContaining({code:'POLICY_CONFLICT'}))
    for(const input of [{revision:1,retentionDays:0,quotaMiB:64},{revision:1,retentionDays:366,quotaMiB:64},{revision:1,retentionDays:1,quotaMiB:1}])expect(()=>f.recordings.save(input)).toThrow()
    const second=new ServerService(new Store(f.path));cleanup.push(()=>second.close());second.unlock(f.key)
    const recording=new RecordingStore(second,()=>0);cleanup.push(()=>recording.close());expect(recording.settings()).toEqual(saved.settings)
    expect(readFileSync(f.path).includes(Buffer.from('retentionDays'))).toBe(false)
  })
  it('compresses before encryption, decodes legacy JSON, binds contexts and rejects corrupt encodings',()=>{
    const f=fixture(),text='synthetic repeat output '.repeat(60),context='synthetic-output'
    const encrypted=f.recordings.encode(context,text)
    expect(encrypted.length).toBeLessThan(Buffer.byteLength(text)/2)
    expect(f.recordings.decode(context,encrypted,'gzip-json')).toBe(text)
    const legacy=f.servers.protect(context,Buffer.from(JSON.stringify('legacy stdout')))
    expect(f.recordings.decode(context,legacy,'json')).toBe('legacy stdout')
    expect(()=>f.recordings.decode('wrong',encrypted,'gzip-json')).toThrow()
    expect(()=>f.recordings.decode(context,encrypted,'unknown')).toThrow()
    const excessive=f.recordings.encode(context,'x'.repeat(100000));expect(()=>f.recordings.decode(context,excessive,'gzip-json')).toThrow()
  })
  it('clears oldest completed output first for capacity; never clears running output',()=>{
    const f=fixture();f.recordings.save({revision:0,retentionDays:30,quotaMiB:64})
    const old=f.insert('succeeded',3,3*1048576),fresh=f.insert('succeeded',1,3*1048576),running=f.insert('running',4,1048576)
    f.recordings.maintain(60*1048576)
    expect(f.has(old)).toBe(false);expect(f.has(fresh)).toBe(true);expect(f.has(running)).toBe(true)
    expect(()=>f.recordings.maintain(64*1048576)).toThrow(expect.objectContaining({code:'OPERATION_LIMIT'}))
    expect(f.has(running)).toBe(true);expect(f.has(fresh)).toBe(true) // atomic rollback on insufficient capacity
  })
  it('manual clearing preserves summary and idempotence; active work and reclaim are protected',()=>{
    const f=fixture(),done=f.insert(),running=f.insert('running')
    expect(()=>f.recordings.clearOutput(running)).toThrow(expect.objectContaining({code:'STORAGE_BUSY'}))
    f.recordings.clearOutput(done);f.recordings.clearOutput(done);expect(f.has(done)).toBe(false)
    expect(()=>f.recordings.reclaim()).toThrow(expect.objectContaining({code:'STORAGE_BUSY'}))
    f.servers.store.db.prepare("UPDATE operations SET state='succeeded' WHERE id=?").run(running)
    f.setActive(1);expect(()=>f.recordings.reclaim()).toThrow();f.setActive(0)
    expect(f.recordings.reclaim().reusableBytes).toBe(0)
    f.servers.lock();expect(()=>f.recordings.stats()).toThrow();expect(()=>f.recordings.clearOutput(done)).toThrow()
  })
  it('rolls back cleanup on write failure without losing outputs',()=>{
    const f=fixture(),id=f.insert('succeeded',8)
    f.servers.store.db.exec("CREATE TRIGGER fail_cleanup BEFORE UPDATE OF replayClearedAt ON operations BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
    expect(()=>f.recordings.maintain()).toThrow(expect.objectContaining({code:'STORAGE_FAILED'}));expect(f.has(id)).toBe(true)
  })
})
