// Best effort exact known-secret filtering. Preserve the suffix across chunks so
// a secret split by TCP/SSH boundaries is not emitted a piece at a time.
export class SecretFilter {
  private pending = ''
  private readonly max: number
  private readonly values: string[]
  constructor(values: string[]) { this.values = [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length); this.max = Math.max(1, ...this.values.map((s) => s.length)) }
  push(text: string, final = false): string {
    this.pending += text
    let i = 0, output = ''
    const end = final ? this.pending.length : Math.max(0, this.pending.length - this.max + 1)
    while (i < end) {
      let position = end, match: string | undefined
      for (const value of this.values) { const found = this.pending.indexOf(value, i); if (found >= 0 && found < position) { position = found; match = value } }
      output += this.pending.slice(i, position)
      if (match) { output += '[REDACTED]'; i = position + match.length } else i = end
    }
    this.pending = this.pending.slice(i)
    return output
  }
}
