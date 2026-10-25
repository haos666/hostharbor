import { expect, it, vi } from 'vitest'
import { readOutputBurst } from '../src/renderer/src/output-reader'
import type { OutputChunk, OutputPage } from '../src/shared/contracts'
function page(cursor: number, count: number): OutputPage { return { chunks: Array.from({ length: count }, (_, index) => ({ seq: cursor + index, stream: 'stdout', elapsedMs: 0, text: String(cursor + index) })), nextCursor: cursor + count, state: 'succeeded' } }
it('drains a completed multi-page result without waiting one polling interval per page', async () => {
  const fetch = vi.fn(async (cursor) => page(cursor, cursor < 40 ? 8 : 3)), chunks: OutputChunk[] = []
  const result = await readOutputBurst(fetch, 0, (next) => chunks.push(...next), () => false)
  expect(result).toEqual({ cursor: 43, more: false, finished: true }); expect(chunks.map((c) => c.seq)).toEqual(Array.from({ length: 43 }, (_, i) => i)); expect(fetch).toHaveBeenCalledTimes(6)
})
it('yields after a bounded burst and continues at the exact next cursor', async () => {
  const fetch = vi.fn(async (cursor) => page(cursor, 8))
  expect(await readOutputBurst(fetch, 0, () => {}, () => false)).toEqual({ cursor: 256, more: true, finished: false })
  expect(fetch).toHaveBeenCalledTimes(32)
})
it('does not restore private output after a lock or selection change during a read', async () => {
  let cancelled = false
  const append = vi.fn()
  const fetch = async () => { cancelled = true; return page(0, 8) }
  expect((await readOutputBurst(fetch, 0, append, () => cancelled)).finished).toBe(false); expect(append).not.toHaveBeenCalled()
})
it('rejects a non-advancing cursor rather than requesting the same page indefinitely', async () => {
  await expect(readOutputBurst(async () => ({ ...page(0, 8), nextCursor: 0 }), 0, () => {}, () => false)).rejects.toThrow('游标')
})

it('commits each consumed page before a later request fails so retry cannot duplicate output', async () => {
  let cursor = 0, failOnce = true
  const seen: number[] = []
  const fetch = async (next: number) => { if (next === 8 && failOnce) { failOnce = false; throw new Error('synthetic transport interruption') } return page(next, next < 8 ? 8 : 2) }
  const append = (chunks: OutputChunk[], next: number) => { cursor = next; seen.push(...chunks.map((c) => c.seq)) }
  await expect(readOutputBurst(fetch, cursor, append, () => false)).rejects.toThrow('synthetic')
  expect(cursor).toBe(8)
  await readOutputBurst(fetch, cursor, append, () => false)
  expect(seen).toEqual(Array.from({ length: 10 }, (_, index) => index))
})
