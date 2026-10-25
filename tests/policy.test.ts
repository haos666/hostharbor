import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultRiskRules } from '../src/shared/risk-presets'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { PolicyService, evaluatePolicy } from '../src/core/policy/service'
import type { ApprovalPolicy, ApprovalRule } from '../src/shared/contracts'
const request = { profileId: randomUUID(), serverId: randomUUID(), command: 'pwd', cwd: '/work' }
const rule = (input: Partial<ApprovalRule> = {}): ApprovalRule => ({ id: randomUUID(), name: 'fixture', enabled: true, action: 'allow', profileIds: [], serverIds: [], command: 'pwd', cwd: null, expiresAt: null, ...input })
const policy = (rules: ApprovalRule[]): ApprovalPolicy => ({ revision: 1, mode: 'rules', rules })
const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach((fn) => fn()))
describe('exact approval policy', () => {
  it('defaults to approval, ignores rules in all-approval, and denies in paused mode', () => {
    expect(evaluatePolicy(policy([]), request).action).toBe('approval')
    expect(evaluatePolicy({ ...policy([rule()]), mode: 'all-approval' }, request).action).toBe('approval')
    expect(evaluatePolicy({ ...policy([rule()]), mode: 'paused' }, request).action).toBe('deny')
  })
  it.each(['pwd; whoami', 'pwd && whoami', 'pwd\nwhoami', ' pwd', 'pwd ', '$(pwd)', 'PWD'])('does not grant a prefix, different whitespace or shell expression: %s', (command) => {
    expect(evaluatePolicy(policy([rule()]), { ...request, command }).action).toBe('approval')
  })
  it('uses deny > approval > allow regardless of ordering and retains all matched rules', () => {
    const allow = rule(), approval = rule({ action: 'approval', command: null }), deny = rule({ action: 'deny', command: null })
    expect(evaluatePolicy(policy([allow, approval]), request).action).toBe('approval')
    for (const rules of [[allow, approval, deny], [deny, allow, approval]]) {
      const result = evaluatePolicy(policy(rules), request)
      expect(result.action).toBe('deny'); expect(result.matchedRules).toHaveLength(3)
    }
  })
  it('requires every selected condition; ignores disabled, expired and wrong scope rules', () => {
    for (const wrong of [{ enabled: false }, { expiresAt: 1000 }, { profileIds: [randomUUID()] }, { serverIds: [randomUUID()] }, { cwd: '/work/' }]) {
      expect(evaluatePolicy(policy([rule(wrong)]), request, 1000).action).toBe('approval')
    }
    expect(evaluatePolicy(policy([rule({ profileIds: [request.profileId], serverIds: [request.serverId], cwd: '/work', expiresAt: 1001 })]), request, 1000).action).toBe('allow')
  })
  it.each(['rm -rf /example', 'sudo /bin/rm -- /example', 'ls; rm file', 'sh -c "rm file"', 'unlink file', 'shred file', 'mkfs.ext4 /dev/example', 'dd if=a of=b', 'wipefs /dev/example', 'shutdown -h now', 'reboot', 'chmod 777 file', 'chown user file'])('ships high-risk approval presets for %s', (command) => {
    const result = evaluatePolicy(policy([rule({ command })]), { ...request, command })
    expect(result.action).toBe('approval')
    expect(result.matchedRules.some((r) => r.risk === 'high' && r.id.startsWith('builtin:'))).toBe(true)
    expect(result.reason).toContain('疑似高风险')
  })
  it('never grants based on absence of a risk keyword; supports disabling and denying a preset', () => {
    const input = { ...request, command: 'rm file' }
    const disabled = defaultRiskRules().map((r) => ({ ...r, enabled: false }))
    expect(evaluatePolicy({ ...policy([]), riskRules: disabled }, input).action).toBe('approval')
    expect(evaluatePolicy(policy([]), { ...request, command: 'arbitrary unrecognized shell' }).action).toBe('approval')
    expect(evaluatePolicy({ ...policy([rule({ command: input.command })]), riskRules: disabled }, input).action).toBe('allow')
    const denied = evaluatePolicy({ ...policy([rule({ command: input.command })]), riskRules: defaultRiskRules().map((r) => ({ ...r, action: 'deny' })) }, input)
    expect(denied.action).toBe('deny'); expect(denied.matchedRules.find((r) => r.risk)?.name).toBe('文件删除')
  })
  it('does not confuse longer words or filenames with keyword tokens', () => {
    for (const command of ['rmdir-example', 'echo rm.txt', 'mychmod', 'ddtool']) {
      expect(evaluatePolicy(policy([]), { ...request, command }).matchedRules).toEqual([])
    }
    // Quoted text can be a false positive: conservative keyword hints are not a shell parser.
    expect(evaluatePolicy(policy([]), { ...request, command: 'echo "rm"' }).matchedRules.some((r) => r.risk)).toBe(true)
  })
  it('persists encrypted policy and restores it after restart; rejects stale edits, corruption and locked access', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hostharbor-policy-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
    const path = join(directory, 'policy.sqlite'), key = randomBytes(32)
    const servers = new ServerService(new Store(path)); cleanup.push(() => servers.close()); servers.unlock(key)
    const service = new PolicyService(servers)
    expect(service.get()).toEqual({ revision: 0, mode: 'all-approval', rules: [] })
    const saved = service.save({ ...service.get(), mode: 'rules', rules: [rule({ command: 'synthetic-secret-command' })], riskRules: defaultRiskRules().map((r) => ({ ...r, action: 'deny' })) })
    expect(saved.revision).toBe(1)
    expect(() => service.save({ ...saved, revision: 0 })).toThrow(expect.objectContaining({ code: 'POLICY_CONFLICT' }))
    expect(readFileSync(path).includes(Buffer.from('synthetic-secret-command'))).toBe(false)
    const restored = new ServerService(new Store(path)); cleanup.push(() => restored.close())
    expect(() => new PolicyService(restored).get()).toThrow(expect.objectContaining({ code: 'VAULT_LOCKED' }))
    restored.unlock(key); expect(new PolicyService(restored).get()).toEqual(saved)
    restored.store.db.exec('UPDATE approval_policy SET revision=2')
    expect(() => new PolicyService(restored).get()).toThrow(expect.objectContaining({ code: 'STORAGE_FAILED' }))
    servers.lock(); expect(() => service.save(saved)).toThrow(expect.objectContaining({ code: 'VAULT_LOCKED' }))
  })
  it('migrates v4 without changing existing profile scope or issuing permissions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hostharbor-migration-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
    const path = join(directory, 'legacy.sqlite'), store = new Store(path), id = randomUUID()
    store.db.prepare('INSERT INTO profiles(id,name,tokenHash,serverIds,mode,expiresAt,createdAt) VALUES(?,?,?,?,?,?,?)').run(id, 'legacy', 'synthetic hash', '[]', 'time-limited', Date.now() + 1000, Date.now())
    store.db.exec("DROP TABLE applications; DROP TABLE server_dossiers; CREATE TABLE profiles_v4 (id TEXT PRIMARY KEY, name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, serverIds TEXT NOT NULL, mode TEXT NOT NULL, expiresAt INTEGER NOT NULL, revokedAt INTEGER, createdAt INTEGER NOT NULL); INSERT INTO profiles_v4 SELECT id,name,tokenHash,serverIds,mode,expiresAt,revokedAt,createdAt FROM profiles; DROP TABLE profiles; ALTER TABLE profiles_v4 RENAME TO profiles; DROP TABLE ai_settings; DROP TABLE approval_policy; DROP TABLE recording_settings; DROP TABLE operation_tombstones; DROP INDEX operations_history; DROP INDEX operations_profile_history; ALTER TABLE operations DROP COLUMN replayClearedAt; ALTER TABLE operations DROP COLUMN replayClearReason; ALTER TABLE operations DROP COLUMN decidedAt; ALTER TABLE operations DROP COLUMN humanDecision; ALTER TABLE operation_output DROP COLUMN encoding; PRAGMA user_version=4;"); store.close()
    const servers = new ServerService(new Store(path)); cleanup.push(() => servers.close()); servers.unlock(randomBytes(32))
    expect(servers.store.db.prepare('SELECT id,mode FROM profiles').get()).toMatchObject({ id, mode: 'time-limited' })
    expect(new PolicyService(servers).get().mode).toBe('all-approval')
    expect(servers.store.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 13 })
  })
  it('rejects broad automatic allow, duplicate IDs, missing scopes and rolls back a failed save', () => {
    const servers = new ServerService(new Store(':memory:')); cleanup.push(() => servers.close()); servers.unlock(randomBytes(32))
    const service = new PolicyService(servers), duplicate = rule()
    for (const rules of [[rule({ command: null })], [duplicate, duplicate], [rule({ serverIds: [randomUUID()] })], [rule({ profileIds: [randomUUID()] })]]) {
      expect(() => service.save({ revision: 0, mode: 'rules', rules })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
    }
    for (const riskRules of [[], [...defaultRiskRules(), defaultRiskRules()[0]], defaultRiskRules().map((r) => ({ ...r, action: 'allow' }))]) {
      expect(() => service.save({ revision: 0, mode: 'rules', rules: [], riskRules })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
    }
    servers.store.db.exec("CREATE TRIGGER fail_policy BEFORE UPDATE ON approval_policy BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
    expect(() => service.save({ revision: 0, mode: 'paused', rules: [] })).toThrow(expect.objectContaining({ code: 'STORAGE_FAILED' }))
    expect(service.get().revision).toBe(0)
  })
})
