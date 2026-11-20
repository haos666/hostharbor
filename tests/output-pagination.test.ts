import { afterEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { utils } from 'ssh2'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { OperationService } from '../src/core/operations/service'
import { mcpToolDefinitions } from '../src/shared/mcp-tools'
import { mcpInstructions } from '../src/shared/mcp-instructions'
import type { OperationState } from '../src/shared/contracts'

const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close() })
// Entirely local encrypted-recording fixtures. No SSH dispatch or real assets.
function fixture(count: number, state: OperationState = 'succeeded') {
  const servers = new ServerService(new Store(':memory:'))
  servers.unlock(randomBytes(32))
  const credential = servers.saveCredential({ name: 'Synthetic output password', kind: 'password', password: 'synthetic-pagination-password' })
  const server = servers.saveServer({ name: 'Synthetic output server', host: 'fixture-output.invalid', port: 22, username: 'fixture-user', credentialId: credential.id })
  const parsed = utils.parseKey(utils.generateKeyPairSync('ecdsa',{bits:256}).private)
  if (parsed instanceof Error || Array.isArray(parsed)) throw Error('Synthetic key fixture')
  const key = parsed.getPublicSSH()
  servers.store.db.prepare('INSERT INTO known_hosts(host,port,key,fingerprint,confirmedAt) VALUES(?,?,?,?,?)').run(server.host,server.port,key,`SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/,'')}`,Date.now())
  const operations = new OperationService(servers)
  cleanup.push(() => { operations.close(); servers.close() })
  const profile = operations.createProfile({ name: 'Synthetic output client', serverIds: [server.id], mode: 'policy', expiresAt: null }).profile
  const pending = operations.start(profile.id,{serverId:server.id,requestKey:'synthetic-pagination',command:'synthetic fixture command',cwd:'/'})
  servers.store.db.prepare('UPDATE operations SET state=?,intentAt=? WHERE id=?').run(state,['awaiting_approval','denied','expired'].includes(state)?null:Date.now(),pending.id)
  for (let seq=0;seq<count;seq++) {
    const stream=seq%2?'stderr':'stdout'
    servers.store.db.prepare("INSERT INTO operation_output(operationId,seq,stream,elapsedMs,data,encoding) VALUES(?,?,?,?,?,'gzip-json')").run(pending.id,seq,stream,seq,operations.recordings.encode(`${pending.id}:output:${seq}:${stream}`,`fragment-${seq}`))
  }
  return { servers, operations, profile, id:pending.id, read:(cursor=0)=>operations.read(pending.id,cursor,profile.id) }
}
describe('recorded output paging contract', () => {
  it.each([0,1,7,8,9,16,19])('drains %i fragments without an empty sentinel page, repetition or execution', count => {
    const f=fixture(count), seen:number[]=[];let cursor=0,calls=0
    for (;;) {
      const page=f.read(cursor);calls++
      expect(page.chunks.length).toBeLessThanOrEqual(8)
      expect(page.outputAvailability).toBe('retained')
      seen.push(...page.chunks.map(c=>c.seq))
      expect(page.outputComplete).toBe(!page.hasMore)
      if (!page.hasMore) { expect(page.agentGuidance).toMatchObject({nextAction:'stop',resume:null});break }
      expect(page.agentGuidance).toMatchObject({nextAction:'read_output',pollAfterMs:null,resume:{tool:'read_output',arguments:{id:f.id,cursor:page.nextCursor}}})
      expect(page.nextCursor).toBeGreaterThan(cursor);cursor=page.nextCursor
      expect(calls).toBeLessThan(5)
    }
    expect(seen).toEqual(Array.from({length:count},(_,i)=>i))
    expect(calls).toBe(Math.max(1,Math.ceil(count/8)))
    expect(f.servers.store.db.prepare('SELECT COUNT(*) n FROM operations').get()!.n).toBe(1)
  })
  it('distinguishes a running empty page from a drained recording and preserves approval handoff', () => {
    const running=fixture(0,'running')
    expect(running.read()).toMatchObject({hasMore:false,outputComplete:false,agentGuidance:{nextAction:'poll',pollAfterMs:2000,resume:{tool:'get_operation',arguments:{id:running.id}}}})
    const awaiting=fixture(0,'awaiting_approval')
    awaiting.servers.store.db.prepare('UPDATE operations SET createdAt=? WHERE id=?').run(Date.now()-180001,awaiting.id)
    expect(awaiting.read()).toMatchObject({hasMore:false,outputComplete:false,agentGuidance:{nextAction:'ask_user',pollAfterMs:null}})
  })
  it('returns saved pages while running, then waits without claiming output is complete', () => {
    const f=fixture(9,'running')
    expect(f.read()).toMatchObject({hasMore:true,outputComplete:false,agentGuidance:{nextAction:'read_output'}})
    expect(f.read(8)).toMatchObject({hasMore:false,outputComplete:false,agentGuidance:{nextAction:'poll',pollAfterMs:2000}})
  })
  it('keeps unknown execution outcomes distinct from local recording exhaustion', () => {
    const f=fixture(9,'unknown')
    expect(f.read()).toMatchObject({hasMore:true,outputComplete:false})
    expect(f.read(8)).toMatchObject({hasMore:false,outputComplete:true,state:'unknown',agentGuidance:{nextAction:'inspect',resume:null,automaticResubmitAllowed:false}})
  })
  it('reports cleared output as unavailable instead of complete or originally empty', () => {
    const f=fixture(9);f.read()
    f.servers.store.db.prepare('DELETE FROM operation_output WHERE operationId=?').run(f.id)
    f.servers.store.db.prepare("UPDATE operations SET replayClearedAt=?,replayClearReason='manual' WHERE id=?").run(Date.now(),f.id)
    expect(f.read(8)).toMatchObject({chunks:[],nextCursor:8,hasMore:false,outputComplete:false,outputAvailability:'cleared',agentGuidance:{nextAction:'stop',resume:null}})
  })
  it.each(['lock','revoke','expire','wrong-owner','removed-scope'] as const)('rechecks authorization before a successor page after %s', action => {
    const f=fixture(9);expect(f.read().hasMore).toBe(true)
    if(action==='lock')f.servers.lock()
    if(action==='revoke')f.operations.revokeProfile(f.profile.id)
    if(action==='expire')f.servers.store.db.prepare('UPDATE profiles SET expiresAt=? WHERE id=?').run(Date.now()-1,f.profile.id)
    if(action==='removed-scope')f.servers.store.db.prepare("UPDATE profiles SET serverIds='[]' WHERE id=?").run(f.profile.id)
    const owner=action==='wrong-owner'?f.operations.createProfile({name:'Synthetic other client',serverIds:f.profile.serverIds,mode:'policy',expiresAt:null}).profile.id:f.profile.id
    expect(()=>f.operations.read(f.id,8,owner)).toThrow()
  })
  it('rejects unsafe cursors and documents per-call limits without permitting rejection bypass', () => {
    const f=fixture(9)
    for(const cursor of [-1,0.5,Infinity,Number.MAX_SAFE_INTEGER+1])expect(()=>f.read(cursor)).toThrow()
    expect(mcpToolDefinitions.read_output.description).toContain('PER CALL, not cumulatively')
    expect(mcpInstructions).toContain('not executing a command or restarting approval waiting')
    expect(mcpInstructions).toContain('explicit client policy rejection')
  })
})
