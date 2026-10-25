// At most four 64 KiB chunks in flight. Drain every request before closing a
// handle on failure; never continue scheduling after a failed batch.
export async function filePipeline<T>(size: number, work: (offset: number, length: number) => Promise<T>, consume: (value: T) => void) {
  const chunk = 65536, concurrency = 4
  for (let offset = 0; offset < size; offset += chunk * concurrency) {
    const pending: Promise<T>[] = []
    for (let n = 0; n < concurrency && offset + n * chunk < size; n++) {
      const position = offset + n * chunk
      pending.push(work(position, Math.min(chunk, size - position)))
    }
    const settled = await Promise.allSettled(pending)
    const failed = settled.find(r => r.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    for (const r of settled) if (r.status === 'fulfilled') consume(r.value)
  }
}
