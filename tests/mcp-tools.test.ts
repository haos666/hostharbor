import { describe, expect, it } from 'vitest'
import { mcpToolDefinitions, toolGuides, toolGroups, toolInputJsonSchema, toolNames } from '../src/shared/mcp-tools'
describe('public MCP tool catalog', () => {
  it('keeps documented parameters and static examples consistent with the real input schemas', () => {
    expect(Object.keys(toolGuides).sort()).toEqual([...toolNames].sort())
    for (const name of toolNames) {
      const guide = toolGuides[name], schema = toolInputJsonSchema(name)
      expect(Object.keys(guide.parameters).sort()).toEqual(Object.keys(schema.properties ?? {}).sort())
      expect(mcpToolDefinitions[name].inputSchema.safeParse(guide.example).success, name).toBe(true)
      expect(toolGroups.some(group => group.id === guide.group)).toBe(true)
      expect(schema.additionalProperties).toBe(false)
    }
  })
  it('publishes actual defaults, limits and required fields without describing execution as automatically approved', () => {
    const command = toolInputJsonSchema('start_command'), logs = toolInputJsonSchema('query_application_logs')
    expect(command.required).toContain('cwd'); expect(command.required).not.toContain('timeoutMs')
    expect(command.properties?.timeoutMs).toMatchObject({ default: 60000, minimum: 100, maximum: 600000 })
    expect(logs.required).toContain('applicationRevision')
    expect(logs.properties?.lines).toMatchObject({ default: 200, minimum: 1, maximum: 500 })
    expect(toolGuides.query_application_logs.notes.join(' ')).toContain('不应用时间过滤')
    expect(toolGuides.cancel_operation.notes.join(' ')).toContain('不证明远端进程已经停止')
  })
})
