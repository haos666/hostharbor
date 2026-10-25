import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { CoreClient } from '../src/main/core-client'
import { setLocale } from '../src/shared/i18n'
const fake = vi.hoisted(() => ({ supported: true, instances: [] as any[], badge: vi.fn(), overlay: vi.fn() }))
vi.mock('electron', () => ({
  app: { getAppPath: () => '/synthetic', dock: { setBadge: fake.badge } },
  nativeImage: { createFromPath: (path: string) => path },
  Notification: class extends EventEmitter {
    static isSupported() { return fake.supported }
    options: unknown
    show = vi.fn()
    close = vi.fn()
    constructor(options: unknown) { super(); this.options = options; fake.instances.push(this) }
  },
}))
import { NativeApprovalNotification } from '../src/main/notifications/native'
import { DesktopApprovalNotifications } from '../src/main/notifications/service'
const directories: string[] = []
afterEach(() => { setLocale('zh-CN'); vi.useRealTimers(); fake.instances.length = 0; fake.supported = true; fake.badge.mockClear(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  vi.useFakeTimers()
  const directory = mkdtempSync(join(tmpdir(), 'hostharbor-reminders-')); directories.push(directory)
  const call = vi.fn().mockResolvedValue({ vault: 'unlocked', ids: ['synthetic-id'] })
  let revision = 0
  const send = vi.fn(), show = vi.fn(), setApprovalCount = vi.fn()
  const window = { isFocused: () => false, isDestroyed: () => false, webContents: { send }, setOverlayIcon: fake.overlay } as unknown as BrowserWindow
  const service = new DesktopApprovalNotifications(directory, { call } as Pick<CoreClient, 'call'>, () => window, () => ({ setApprovalCount }) as any, () => revision, show)
  return { service, call, send, show, setApprovalCount, lock: () => { revision++; service.locked() } }
}
describe('native notification delivery', () => {
  it('uses the current language for new native notifications and includes only counts', async () => {
    vi.useFakeTimers(); setLocale('en')
    const native = new NativeApprovalNotification()
    const result = native.show({ sequence: 1, count: 2, operationId: 'synthetic-private-id' }, false, vi.fn())
    expect(fake.instances[0].options).toEqual({ title: 'HostHarbor · Approval pending', body: '2 operations await approval. Click to open Approvals.', silent: true, timeoutType: 'default' })
    fake.instances[0].emit('show'); expect(await result).toBe('shown')
    setLocale('zh-CN')
    const test = native.show(null, false, vi.fn())
    expect(fake.instances[1].options.body).toBe('这是一条测试通知，点击打开审批中心。')
    fake.instances[1].emit('show'); expect(await test).toBe('shown')
  })
  it('returns actual native show/failure/unknown rather than claiming delivery on show()', async () => {
    vi.useFakeTimers(); const native = new NativeApprovalNotification()
    const displayed = native.show({ sequence: 1, count: 2 }, false, vi.fn())
    const first = fake.instances[0]
    expect(first.options).toEqual({ title: 'HostHarbor · 待审批', body: '有 2 项操作等待审批，点击打开审批中心。', silent: true, timeoutType: 'default' })
    first.emit('show'); expect(await displayed).toBe('shown')
    const failed = native.show(null, true, vi.fn()); fake.instances[1].emit('failed', {}, 'raw OS error must never appear in UI')
    expect(await failed).toBe('failed'); expect(native.lastDelivery).toBe('failed')
    const unknown = native.show(null, false, vi.fn()); vi.advanceTimersByTime(4000); expect(await unknown).toBe('unknown')
    fake.instances[2].emit('failed'); expect(native.lastDelivery).toBe('failed')
    fake.instances[2].close.mockImplementation(() => { throw new Error('native unavailable') })
    expect(() => native.close()).not.toThrow()
  })
  it('does not call unavailable native APIs and keeps failure safe', () => {
    fake.supported = false; const native = new NativeApprovalNotification()
    expect(() => native.show(null, false, vi.fn())).toThrow(expect.objectContaining({ code: 'NOTIFICATION_UNSUPPORTED' }))
    expect(fake.instances).toHaveLength(0)
  })
})
describe('Main notification lifecycle', () => {
  it.each(['lock', 'stop'])('discards a poll that completes after %s', async action => {
    const f = fixture(); let resolve!: (value: unknown) => void
    f.call.mockImplementation(() => new Promise(r => { resolve = r }))
    const pending = f.service.poll()
    if (action === 'lock') f.lock(); else f.service.stop()
    resolve({ vault: 'unlocked', ids: ['late-sensitive-id'] }); await pending; vi.advanceTimersByTime(5000)
    expect(fake.instances).toHaveLength(0)
    expect(f.setApprovalCount).not.toHaveBeenCalledWith(1)
    f.service.stop()
  })
  it('polls without renderer requests, preserves clicks until consumed, closes and stops cleanly', async () => {
    const f = fixture(); f.service.start(); await Promise.resolve(); vi.advanceTimersByTime(1500)
    expect(fake.instances).toHaveLength(1)
    fake.instances[0].emit('show'); fake.instances[0].emit('click')
    expect(f.show).toHaveBeenCalledTimes(1)
    expect(f.send).toHaveBeenCalledWith('approvals:navigation')
    expect(f.service.takeNavigation()).toEqual({ sequence: 1, operationId: 'synthetic-id' })
    expect(f.service.takeNavigation()).toBeNull()
    f.service.saveSettings({ revision: 0, badge: false, system: false, sound: false })
    expect(f.setApprovalCount).toHaveBeenLastCalledWith(0)
    expect(fake.instances[0].close).toHaveBeenCalled()
    f.service.stop(); const calls = f.call.mock.calls.length; vi.advanceTimersByTime(10000); expect(f.call.mock.calls.length).toBe(calls)
  })
})
