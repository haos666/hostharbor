import { describe, it, expect } from 'vitest'
import { inferenceBody, parseInference, type AiMessage } from '../src/core/ai/inference'
const tool = { name: 'investigate', description: 'test', schema: { type: 'object' } }
describe('live-compatible AI envelopes', () => {
  it('preserves full Anthropic thinking/signature/text/tool blocks across rounds without rendering them', () => {
    const content = [{ type: 'thinking', thinking: 'synthetic opaque reasoning', signature: 'synthetic-signature' }, { type: 'text', text: 'synthetic explanation' }, { type: 'tool_use', id: 'call:123.0', name: 'investigate', input: { query: 'process', target: '123' } }]
    const turn = parseInference('anthropic', { stop_reason: 'tool_use', content })
    const messages: AiMessage[] = [{ role: 'user', text: 'synthetic' }, { role: 'assistant', calls: turn.calls, anthropicContent: turn.anthropicContent }, { role: 'results', results: [{ id: turn.calls[0].id, value: { error: 'schema feedback' }, error: true }] }]
    const body = inferenceBody('anthropic', 'MiniMax-M3.1-Flash', 'system', messages, [tool]) as any
    expect(body.messages[1].content).toEqual(content); expect(body.messages[2].content[0].is_error).toBe(true)
    expect(body.output_config).toEqual({ effort: 'low' }); expect(body.max_tokens).toBe(8192)
    expect(inferenceBody('anthropic', 'claude-fixture', 'system', [], [tool])).not.toHaveProperty('output_config')
  })
  it('accepts a bounded batch of valid calls despite parallel hints, and diagnoses overflow without content', () => {
    const calls = Array.from({ length: 3 }, (_, i) => ({ type: 'tool_use', id: `call-${i}`, name: 'investigate', input: { query: 'process', target: String(100 + i) } }))
    expect(parseInference('anthropic', { stop_reason: 'tool_use', content: calls }).calls).toHaveLength(3)
    try { parseInference('anthropic', { stop_reason: 'tool_use', content: Array.from({ length: 17 }, (_, i) => ({ ...calls[0], id: `call-${i}` })) }); expect.fail('expected bounded failure') }
    catch (e) { expect(e).toMatchObject({ code: 'AI_TOOL_FORMAT', diagnostic: 'anthropic; stage=call_limit; stop=tool_use; calls=17; blocks=17' }) }
  })
  it('returns only structural diagnostics for invalid envelopes and tool identities', () => {
    try { parseInference('anthropic', { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: '', name: 'investigate', input: { private: 'synthetic-content-must-not-be-logged' } }] }) }
    catch (e) { expect(e).toMatchObject({ diagnostic: 'anthropic; stage=tool_identity; stop=tool_use; calls=1; blocks=1' }); expect(JSON.stringify(e)).not.toContain('synthetic-content') }
  })
  it.each([
    ['anthropic', { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: 'incomplete' }] }, 'AI_OUTPUT_TRUNCATED'],
    ['openai', { choices: [{ finish_reason: 'length', message: { content: null } }] }, 'AI_OUTPUT_TRUNCATED'],
    ['anthropic', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not a tool' }] }, 'AI_NO_TOOL_CALL'],
    ['openai', { choices: [{ finish_reason: 'stop', message: { content: 'not a tool' } }] }, 'AI_NO_TOOL_CALL'],
    ['anthropic', { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'bad\nID', name: 'x', input: {} }] }, 'AI_TOOL_FORMAT'],
  ] as const)('distinguishes %s response failures safely', (provider, body, code) => {
    expect(() => parseInference(provider, body)).toThrow(expect.objectContaining({ code }))
  })
})
