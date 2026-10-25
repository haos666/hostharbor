import { expect, it } from 'vitest'
import { SecretFilter } from '../src/core/operations/redaction'
it('filters overlapping known secrets across arbitrary output chunk boundaries', () => {
  const filter = new SecretFilter(['secret-value', 'secret', '值🔐'])
  let output = ''
  for (const char of 'before secret-value after secret 值🔐 end') output += filter.push(char)
  output += filter.push('', true)
  expect(output).toBe('before [REDACTED] after [REDACTED] [REDACTED] end')
})
