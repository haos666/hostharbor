import type { OutputChunk } from '../../shared/contracts'
export const finishedOperation = (state: string) => ['succeeded','failed','denied','interrupted','unknown','expired'].includes(state)
export function replayDuration(chunks: OutputChunk[]): number { return chunks.length ? Math.max(0, Math.max(...chunks.map((c) => c.elapsedMs)) - chunks[0].elapsedMs) : 0 }
export function replayText(chunks: OutputChunk[], position: number, stream: 'all' | 'stdout' | 'stderr'): { text: string; truncated: boolean } {
  const start = chunks[0]?.elapsedMs ?? 0
  let text = '', truncated = false, elapsed = 0
  for (const chunk of chunks) {
    elapsed = Math.max(elapsed, chunk.elapsedMs - start)
    if (elapsed > position) break
    if (stream !== 'all' && stream !== chunk.stream) continue
    text += (stream === 'all' && chunk.stream === 'stderr' ? '[stderr] ' : '') + chunk.text
    if (text.length > 1048576) { text = text.slice(-1048576); truncated = true }
  }
  return { text, truncated }
}
