import { afterEach, expect, it, vi } from 'vitest'
import { filePipeline } from '../src/core/files/pipeline'
import { TransferDeadline } from '../src/core/files/deadlines'
import { fileSettingsSchema } from '../src/shared/files'
afterEach(() => vi.useRealTimers())
it('bounds parallel work to four chunks and consumes in source order despite reversed completions', async () => {
  const consumed: number[] = [], lengths: number[] = []
  let active = 0, maximum = 0
  await filePipeline(65536 * 9 + 17, async (offset, length) => {
    active++; maximum = Math.max(maximum, active); lengths.push(length)
    await new Promise(resolve => setTimeout(resolve, 5 - offset / 65536 % 4))
    active--; return offset
  }, value => consumed.push(value))
  expect(maximum).toBe(4); expect(active).toBe(0)
  expect(consumed).toEqual(Array.from({ length: 10 }, (_, n) => n * 65536))
  expect(lengths.at(-1)).toBe(17)
})
it('drains failed batches before returning and never schedules subsequent chunks', async () => {
  let settled = 0
  const work = vi.fn(async (offset: number) => {
    await new Promise(resolve => setTimeout(resolve, offset ? 10 : 1)); settled++
    if (!offset) throw new Error('synthetic failure')
    return offset
  }), consume = vi.fn()
  await expect(filePipeline(65536 * 20, work, consume)).rejects.toThrow('synthetic failure')
  expect(settled).toBe(4); expect(work).toHaveBeenCalledTimes(4); expect(consume).not.toHaveBeenCalled()
})
it('handles empty files without scheduling any read/write', async () => {
  const work = vi.fn(), consume = vi.fn(); await filePipeline(0, work, consume)
  expect(work).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled()
})
it('refreshes stall deadlines with real progress but cannot extend the total deadline', () => {
  vi.useFakeTimers(); const fail = vi.fn(), deadline = new TransferDeadline(1000, 300, fail)
  for (let n = 0; n < 4; n++) { vi.advanceTimersByTime(200); deadline.progress() }
  expect(fail).not.toHaveBeenCalled(); vi.advanceTimersByTime(200)
  expect(fail.mock.calls[0][0].code).toBe('FILE_TOTAL_TIMEOUT')
  deadline.progress(); vi.advanceTimersByTime(2000); expect(fail).toHaveBeenCalledTimes(1)
})
it('times out stalled verification and clears both timers on termination', () => {
  vi.useFakeTimers(); const fail = vi.fn(), deadline = new TransferDeadline(10000, 300, fail)
  vi.advanceTimersByTime(250); deadline.progress(); vi.advanceTimersByTime(299)
  expect(fail).not.toHaveBeenCalled(); vi.advanceTimersByTime(1)
  expect(fail.mock.calls[0][0].code).toBe('FILE_IDLE_TIMEOUT')
  expect(vi.getTimerCount()).toBe(0)
})
it('cancels all deadlines after successful completion', () => {
  vi.useFakeTimers(); const fail = vi.fn(), deadline = new TransferDeadline(1000, 300, fail)
  deadline.close(); deadline.progress(); vi.advanceTimersByTime(5000)
  expect(fail).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
})
it('loads old file settings with standard verification and independent timeout defaults', () => {
  const old = { serverId: '00000000-0000-4000-8000-000000000001', revision: 1, uploadEnabled: true, uploadDirectory: '/srv/files', maxFileSizeMiB: 500 }
  expect(fileSettingsSchema.parse(old)).toMatchObject({ verification: 'standard', idleTimeoutSeconds: 120, totalTimeoutMinutes: 120 })
  for (const change of [{ idleTimeoutSeconds: 0 }, { totalTimeoutMinutes: 1441 }, { verification: 'skip' }]) expect(fileSettingsSchema.safeParse({ ...old, ...change }).success).toBe(false)
})

it('lets an actively progressing transfer run beyond ten minutes under its independent total limit', () => {
  vi.useFakeTimers(); const fail = vi.fn(), deadline = new TransferDeadline(7200000, 120000, fail)
  for (let n = 0; n < 20; n++) { vi.advanceTimersByTime(60000); deadline.progress() }
  expect(fail).not.toHaveBeenCalled(); deadline.close()
})
