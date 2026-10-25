import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IdleLockService, IdleLockSettingsStore } from '../src/main/idle-lock'
const cleanup: (() => void)[] = []
afterEach(() => { vi.useRealTimers(); cleanup.splice(0).reverse().forEach(fn => fn()) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'hostharbor-idle-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  let time = 0, idle = 10000, revision = 0, vault = 'unlocked'
  const status = vi.fn(async () => ({ vault }))
  const core = { call: status } as unknown as ConstructorParameters<typeof IdleLockService>[1]
  const lock = vi.fn(async () => { revision++; vault = 'locked' })
  const sample = vi.fn(() => idle)
  const service = new IdleLockService(directory, core, () => revision, sample, lock, () => time)
  cleanup.push(() => service.stop())
  return { directory, service, status, lock, sample, setTime: (value: number) => { time = value }, setIdle: (value: number) => { idle = value }, setVault: (value: string) => { vault = value }, invalidate: () => { revision++ } }
}
describe('desktop idle lock', () => {
  it('stores only the three supported durations atomically and refuses corruption or stale revisions', () => {
    const f = fixture(), store = f.service.settings
    expect(store.get()).toEqual({ revision: 0, seconds: 1800 })
    for (const seconds of [30, 1800, null] as const) {
      const saved = store.save({ ...store.get(), seconds })
      expect(new IdleLockSettingsStore(f.directory).get()).toEqual(saved)
    }
    expect(() => store.save({ revision: 0, seconds: null })).toThrow(expect.objectContaining({ code: 'IDLE_LOCK_CONFLICT' }))
    for (const seconds of [0, 1, 60, 1801, -1, '30', undefined]) expect(() => store.save({ revision: 3, seconds })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
    expect(JSON.parse(readFileSync(join(f.directory, 'idle-lock-settings.json'), 'utf8'))).toEqual({ revision: 3, seconds: null })
    writeFileSync(join(f.directory, 'idle-lock-settings.json'), '{}')
    expect(() => store.get()).toThrow(expect.objectContaining({ code: 'STORAGE_FAILED' }))
  })
  it.each([30, 1800] as const)('locks at %s seconds and gives a complete fresh-unlock grace period', async seconds => {
    const f = fixture()
    await f.service.save({ revision: 0, seconds })
    await f.service.poll(); expect(f.lock).not.toHaveBeenCalled()
    f.setTime(seconds * 1000 - 1); await f.service.poll(); expect(f.lock).not.toHaveBeenCalled()
    f.setTime(seconds * 1000); await f.service.poll(); expect(f.lock).toHaveBeenCalledTimes(1)
    await f.service.poll(); expect(f.lock).toHaveBeenCalledTimes(1)
    f.setVault('unlocked'); f.service.reset(); await f.service.poll()
    expect(f.lock).toHaveBeenCalledTimes(1)
    f.setTime(seconds * 2000); await f.service.poll(); expect(f.lock).toHaveBeenCalledTimes(2)
  })
  it('counts OS input, while continued Core/MCP work does not extend the deadline', async () => {
    const f = fixture(); await f.service.save({ revision: 0, seconds: 30 }); await f.service.poll()
    f.setTime(60000); f.setIdle(1); await f.service.poll(); expect(f.lock).not.toHaveBeenCalled()
    // Repeated status/background work does not reset the user-input counter.
    f.setTime(89000); f.setIdle(29); await f.service.poll(); expect(f.lock).not.toHaveBeenCalled()
    f.setTime(90000); f.setIdle(30); await f.service.poll(); expect(f.lock).toHaveBeenCalledTimes(1)
  })
  it('supports off without querying idle time and applies a changed duration from a fresh interval', async () => {
    const f = fixture(); await f.service.save({ revision: 0, seconds: null }); await f.service.poll()
    f.setTime(99999999); await f.service.poll()
    expect(f.sample).not.toHaveBeenCalled(); expect(f.lock).not.toHaveBeenCalled()
    await f.service.save({ revision: 1, seconds: 30 }); await f.service.poll()
    expect(f.lock).not.toHaveBeenCalled()
    f.setTime(100030000); await f.service.poll(); expect(f.lock).toHaveBeenCalledTimes(1)
  })
  it.each(['reset', 'lock-revision', 'stop'] as const)('discards an old asynchronous status after %s', async change => {
    const f = fixture(); await f.service.save({ revision: 0, seconds: 30 }); await f.service.poll()
    f.setTime(31000)
    let resolve!: (state: { vault: string }) => void
    f.status.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const poll = f.service.poll()
    if (change === 'reset') f.service.reset()
    if (change === 'lock-revision') f.invalidate()
    if (change === 'stop') f.service.stop()
    resolve({ vault: 'unlocked' }); await poll; expect(f.lock).not.toHaveBeenCalled()
  })
  it('refuses locked changes and changes racing with a lock or stop', async () => {
    const f = fixture(); f.setVault('locked')
    await expect(f.service.save({ revision: 0, seconds: null })).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    let resolve!: (state: { vault: string }) => void
    f.status.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const saving = f.service.save({ revision: 0, seconds: null })
    f.invalidate(); resolve({ vault: 'unlocked' })
    await expect(saving).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    expect(f.service.get()).toEqual({ revision: 0, seconds: 1800 })
  })
  it('fails closed on corrupt settings and invalid OS sampling, retrying failed locks', async () => {
    const f = fixture()
    await f.service.save({ revision: 0, seconds: null })
    writeFileSync(join(f.directory, 'idle-lock-settings.json'), 'invalid')
    f.lock.mockRejectedValueOnce(new Error('synthetic transport failure'))
    await f.service.poll(); expect(f.lock).toHaveBeenCalledTimes(1)
    await f.service.poll(); expect(f.lock).toHaveBeenCalledTimes(2)
    rmSync(join(f.directory, 'idle-lock-settings.json'))
    f.setVault('unlocked'); f.service.reset(); f.setIdle(NaN)
    await f.service.poll(); expect(f.lock).toHaveBeenCalledTimes(3)
  })
  it('uses a single Main timer and never overlaps polls or runs after stop', async () => {
    const f = fixture(); vi.useFakeTimers()
    f.service.start(); f.service.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.status).toHaveBeenCalledTimes(6)
    f.service.stop(); await vi.advanceTimersByTimeAsync(5000)
    expect(f.status).toHaveBeenCalledTimes(6)
    let resolve!: (state: { vault: string }) => void
    const g = fixture(); g.status.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const poll = g.service.poll(); await g.service.poll()
    expect(g.status).toHaveBeenCalledTimes(1)
    resolve({ vault: 'locked' }); await poll
  })
})
