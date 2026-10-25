import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ApprovalReminderTracker, type ReminderSink } from '../src/main/notifications/tracker'
import { NotificationSettingsStore, defaultNotificationPreferences } from '../src/main/notifications/settings'
import type { ApprovalReminder } from '../src/shared/contracts'
const directories: string[] = []
afterEach(() => { vi.useRealTimers(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  vi.useFakeTimers()
  const sink: ReminderSink = { badge: vi.fn(), inApp: vi.fn(), system: vi.fn(), closeSystem: vi.fn(), focused: vi.fn(() => false), navigate: vi.fn() }
  const tracker = new ApprovalReminderTracker({ ...defaultNotificationPreferences }, sink)
  const update = (...ids: string[]) => tracker.update({ vault: 'unlocked', ids })
  return { sink, tracker, update }
}
describe('approval reminder batching and identity', () => {
  it('batches IDs, deduplicates polling, and does not miss same-count replacements', () => {
    const { sink, tracker, update } = fixture()
    update('a'); vi.advanceTimersByTime(1000); update('a', 'b'); vi.advanceTimersByTime(500)
    expect(sink.system).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sink.system).mock.calls[0][0]).toMatchObject({ count: 2, operationId: undefined })
    update('a', 'b'); vi.advanceTimersByTime(5000); expect(sink.system).toHaveBeenCalledTimes(1)
    update('a', 'c'); vi.advanceTimersByTime(1500); expect(sink.system).toHaveBeenCalledTimes(2)
    tracker.stop()
  })
  it('tracks current pending count independently of reads/focus and clears resolved batches', () => {
    const { sink, tracker, update } = fixture()
    update('a'); expect(sink.badge).toHaveBeenLastCalledWith(1)
    update(); vi.advanceTimersByTime(2000); expect(sink.system).not.toHaveBeenCalled(); expect(sink.badge).toHaveBeenLastCalledWith(0)
    update('b'); vi.advanceTimersByTime(1500)
    vi.mocked(sink.focused).mockReturnValue(true); update('b')
    expect(sink.badge).toHaveBeenLastCalledWith(1); expect(sink.system).toHaveBeenCalledTimes(1)
    tracker.stop()
  })
  it('uses only in-app reminders in foreground and only generic IDs/counts in its contract', () => {
    const { sink, tracker, update } = fixture(); vi.mocked(sink.focused).mockReturnValue(true)
    update('a'); vi.advanceTimersByTime(1500)
    expect(sink.system).not.toHaveBeenCalled()
    expect(sink.inApp).toHaveBeenLastCalledWith({ sequence: 1, count: 1, operationId: 'a' })
    vi.mocked(sink.focused).mockReturnValue(false); update('a'); vi.advanceTimersByTime(2000); expect(sink.system).not.toHaveBeenCalled()
    tracker.stop()
  })
  it('does not grant approval on notification click and rechecks a stale target', () => {
    const { sink, tracker, update } = fixture()
    update('a'); vi.advanceTimersByTime(1500)
    const click = vi.mocked(sink.system).mock.calls[0][1]
    click(); expect(sink.navigate).toHaveBeenLastCalledWith('a')
    update(); click(); expect(sink.navigate).toHaveBeenLastCalledWith(undefined)
    tracker.stop()
  })
  it('honors toggles without changing pending state or replaying old requests', () => {
    const { sink, tracker, update } = fixture()
    tracker.configure({ revision: 1, badge: false, system: false, sound: true })
    update('a'); vi.advanceTimersByTime(1500)
    expect(sink.badge).toHaveBeenLastCalledWith(0); expect(sink.system).not.toHaveBeenCalled()
    expect(sink.inApp).toHaveBeenLastCalledWith(expect.objectContaining({ count: 1 }))
    tracker.configure({ revision: 2, badge: true, system: true, sound: false }); update('a'); vi.advanceTimersByTime(2000)
    expect(sink.badge).toHaveBeenLastCalledWith(1); expect(sink.system).not.toHaveBeenCalled()
    tracker.stop()
  })
  it.each(['lock', 'unavailable', 'stop'])('cancels queued reminders on %s and rejects late polls after stop', action => {
    const { sink, tracker, update } = fixture(); update('a')
    if (action === 'lock') tracker.update({ vault: 'locked', ids: ['a'] })
    else if (action === 'unavailable') tracker.unavailable()
    else tracker.stop()
    vi.advanceTimersByTime(1500); expect(sink.system).not.toHaveBeenCalled(); expect(sink.badge).toHaveBeenLastCalledWith(0)
    if (action === 'stop') { update('b'); vi.advanceTimersByTime(1500); expect(sink.system).not.toHaveBeenCalled() }
    else { update('a'); vi.advanceTimersByTime(1500); expect(sink.system).not.toHaveBeenCalled() }
    tracker.stop()
  })
})
describe('local notification preferences', () => {
  it('persists versioned booleans across restart and rejects stale/invalid edits', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hostharbor-notifications-')); directories.push(directory)
    const store = new NotificationSettingsStore(directory)
    expect(store.get()).toEqual(defaultNotificationPreferences)
    const next = store.save({ revision: 0, badge: false, system: true, sound: true })
    expect(new NotificationSettingsStore(directory).get()).toEqual(next)
    expect(() => store.save({ ...next, revision: 0 })).toThrow(expect.objectContaining({ code: 'NOTIFICATION_CONFLICT' }))
    expect(() => store.save({ ...next, sound: 'true' })).toThrow()
    expect(() => store.save({ ...next, extra: 'secret' })).toThrow()
    expect(readdirSync(directory)).toEqual(['notification-settings.json'])
    expect(Object.keys(JSON.parse(readFileSync(join(directory, 'notification-settings.json'), 'utf8'))).sort()).toEqual(['badge', 'revision', 'sound', 'system'])
  })
  it('preserves corrupt settings instead of silently enabling notifications', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hostharbor-notifications-')); directories.push(directory)
    const path = join(directory, 'notification-settings.json'); writeFileSync(path, 'corrupt')
    const store = new NotificationSettingsStore(directory)
    expect(() => store.get()).toThrow(expect.objectContaining({ code: 'STORAGE_FAILED' }))
    expect(() => store.save(defaultNotificationPreferences)).toThrow()
    expect(readFileSync(path, 'utf8')).toBe('corrupt')
  })
})
