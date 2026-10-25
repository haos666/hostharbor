import type { CommandInput } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { parseQueryShell } from '../policy/query-shell'
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// Compatibility only for one literal sudo command. Never guess privilege scope of a list/pipeline.
export function normalizeElevation(input: CommandInput): CommandInput {
  if (!/^\s*(?:sudo|\/usr\/bin\/sudo)(?:\s|$)/.test(input.command)) return input
  try {
    const pipelines = parseQueryShell(input.command)
    if (pipelines.length !== 1 || pipelines[0].commands.length !== 1) throw new Error()
    const c = pipelines[0].commands[0], words = c.words.slice(1)
    if (words[0] === '-u' && words[1] === 'root') words.splice(0, 2)
    if (words[0] === '--') words.shift()
    if (!words.length || words[0].startsWith('-') || ['sudo', '/usr/bin/sudo', 'su'].includes(words[0])) throw new Error()
    return { ...input, elevation: 'sudo', command: [...words.map(quote), ...c.redirects].join(' ') }
  } catch { throw new AppError('SUDO_INPUT') }
}
export function sudoCommand(command: string, prompt: string, password: boolean): string {
  return `/usr/bin/sudo -k ${password ? `-S -p ${quote(prompt)}` : '-n'} -u root -- /bin/sh -c ${quote(`exec </dev/null; ${command}`)}`
}

// Only this fresh prompt can consume one password. Output is handled before recording.
export class SudoConversation {
  private pending = Buffer.alloc(0)
  private sent = false
  private authenticated = false
  constructor(private readonly prompt: string, private password: Buffer | undefined, private readonly send: (value: Buffer) => void) {}
  stderr(data: Buffer): Buffer {
    if (this.authenticated || !this.password) return data
    this.pending = Buffer.concat([this.pending, data])
    const token = Buffer.from(this.prompt), index = this.pending.indexOf(token)
    if (index >= 0) {
      if (this.sent) throw new AppError('SUDO_FAILED')
      this.sent = true
      const output = Buffer.concat([this.pending.subarray(0, index), this.pending.subarray(index + token.length)])
      this.pending = Buffer.alloc(0)
      const line = Buffer.concat([this.password, Buffer.from('\n')])
      // send owns this buffer until the transport callback completes.
      this.send(line)
      this.password.fill(0)
      return output
    }
    let keep = Math.min(this.pending.length, token.length - 1)
    while (keep && !this.pending.subarray(this.pending.length - keep).equals(token.subarray(0, keep))) keep--
    const out = this.pending.subarray(0, this.pending.length - keep)
    this.pending = Buffer.from(this.pending.subarray(this.pending.length - keep))
    return out
  }
  ready(): void { this.authenticated = true; this.password?.fill(0); this.password = undefined }
  finish(): Buffer { const out = this.pending; this.pending = Buffer.alloc(0); return out }
  close(): void { this.password?.fill(0); this.password = undefined; this.pending.fill(0); this.pending = Buffer.alloc(0) }
}
