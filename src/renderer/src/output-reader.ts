import type { OutputChunk, OutputPage } from '../../shared/contracts'
import { msg } from '../../shared/i18n'
const finishedStates = new Set(['succeeded', 'failed', 'denied', 'interrupted', 'unknown', 'expired'])
// Drain bounded pages promptly instead of waiting a full polling interval for
// every eight chunks. Yield after 32 pages so the UI can paint and cancel.
export async function readOutputBurst(fetchPage: (cursor: number) => Promise<OutputPage>, cursor: number, append: (chunks: OutputChunk[], nextCursor: number) => void, cancelled: () => boolean) {
  for (let pageNumber = 0; pageNumber < 32; pageNumber++) {
    const page = await fetchPage(cursor)
    if (cancelled()) return { cursor, more: false, finished: false }
    if (page.nextCursor < cursor || (page.chunks.length > 0 && page.nextCursor <= cursor)) throw new Error(msg('output.cursorStalled'))
    cursor = page.nextCursor
    append(page.chunks, cursor)
    if (page.chunks.length < 8) return { cursor, more: false, finished: finishedStates.has(page.state) }
  }
  return { cursor, more: true, finished: false }
}
