import { msg } from '../../../shared/i18n'
import { useRef, useState, type KeyboardEvent } from 'react'
import { ChevronRight, Code2, Folder, Search, X } from 'lucide-react'
import { mcpToolDefinitions, toolInputJsonSchema, toolNames, type McpToolName } from '../../../shared/mcp-tools'
import { toolGroups, toolGuides } from '../catalog'
type JsonField = { type?: string; format?: string; default?: unknown; minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number; minLength?: number; maxLength?: number; pattern?: string }
export function McpToolBrowser() {
  const [selected, setSelected] = useState<McpToolName>('list_servers'), [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>(toolGroups.map(g => g.id)), [focused, setFocused] = useState<string>('list_servers')
  const tree = useRef<HTMLUListElement>(null), detail = useRef<HTMLElement>(null)
  const search = query.trim().toLocaleLowerCase()
  const filtered = toolNames.filter(name => !search || [name, toolGuides[name].title, toolGuides[name].summary, toolGroups.find(g => g.id === toolGuides[name].group)!.label].some(s => s.toLocaleLowerCase().includes(search)))
  const active = filtered.includes(selected) ? selected : filtered[0], guide = active ? toolGuides[active] : null
  const schema = active ? toolInputJsonSchema(active) : null
  const properties = (schema?.properties ?? {}) as Record<string, JsonField>, required = schema?.required as string[] | undefined
  const focusKey = (key: string) => { setFocused(key); tree.current?.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)?.focus() }
  function toggle(group: string) { setExpanded(current => current.includes(group) ? current.filter(g => g !== group) : [...current, group]) }
  function navigate(event: KeyboardEvent<HTMLUListElement>) {
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'treeitem') return
    const nodes = Array.from(tree.current!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')), index = nodes.indexOf(target as HTMLButtonElement)
    const key = target.dataset.key!, group = target.dataset.group!
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : Math.max(0, Math.min(nodes.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      focusKey(nodes[next].dataset.key!)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault(); if (key.startsWith('group-')) { if (!expanded.includes(group)) toggle(group); else if (nodes[index + 1]?.dataset.group === group) focusKey(nodes[index + 1].dataset.key!) }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault(); if (!key.startsWith('group-')) focusKey(`group-${group}`); else if (expanded.includes(group)) toggle(group)
    }
  }
  function choose(name: McpToolName) { setSelected(name); detail.current?.scrollTo({ top: 0 }) }
  const visibleKeys = toolGroups.flatMap(g => {
    const names = filtered.filter(n => toolGuides[n].group === g.id)
    return names.length ? [`group-${g.id}`, ...(expanded.includes(g.id) ? names : [])] : []
  })
  const tabStop = visibleKeys.includes(focused) ? focused : active && visibleKeys.includes(active) ? active : visibleKeys[0]
  return <div className="mcp-browser-section" role="tabpanel" id="mcp-tools-panel" aria-labelledby="mcp-tools-tab">
    <div className="mcp-tools-intro"><strong>{msg('mcpToolBrowser.builtInTools')} <span>{toolNames.length}</span></strong><p>{msg('mcpToolBrowser.localToolReferenceBrowsingDoesNotStartThe')}</p></div>
    <div className="mcp-browser"><aside className="mcp-tool-sidebar" aria-label={msg('mcpToolBrowser.toolNavigation')}><label className="mcp-tool-search"><Search size={15} /><input aria-label={msg('mcpToolBrowser.searchTools')} placeholder={msg('mcpToolBrowser.searchNameOrPurpose')} value={query} onChange={e => { setQuery(e.target.value); detail.current?.scrollTo({ top: 0 }); setExpanded(toolGroups.map(g => g.id)) }} />{query && <button className="icon-button" aria-label={msg('mcpToolBrowser.clearToolSearch')} onClick={() => setQuery('')}><X size={14} /></button>}</label>
      <ul className="mcp-tool-tree" role="tree" aria-label={msg('mcpToolBrowser.mcpTools')} ref={tree} onKeyDown={navigate}>{toolGroups.map(group => {
        const names = filtered.filter(name => toolGuides[name].group === group.id), open = expanded.includes(group.id)
        if (!names.length) return null
        return <li key={group.id} role="none"><button className="mcp-tool-group" role="treeitem" aria-expanded={open} aria-level={1} aria-owns={open ? `mcp-tree-group-${group.id}` : undefined} data-key={`group-${group.id}`} data-group={group.id} tabIndex={tabStop === `group-${group.id}` ? 0 : -1} onFocus={() => setFocused(`group-${group.id}`)} onClick={() => toggle(group.id)}><ChevronRight size={13} className={open ? 'expanded' : ''} /><Folder size={14} /><span>{group.label}</span><small>{names.length}</small></button>{open && <ul role="group" id={`mcp-tree-group-${group.id}`}>{names.map(name => <li key={name} role="none"><button className="mcp-tool-leaf" role="treeitem" aria-level={2} aria-selected={name === active} data-key={name} data-group={group.id} tabIndex={tabStop === name ? 0 : -1} onFocus={() => setFocused(name)} onClick={() => choose(name)}><Code2 size={14} /><span><strong>{toolGuides[name].title}</strong><code>{name}</code></span></button></li>)}</ul>}</li>
      })}</ul>
      {!filtered.length && <div className="mcp-tool-no-results"><p>{msg('mcpToolBrowser.noMatchingTools')}</p><button className="credential-secondary" onClick={() => setQuery('')}>{msg('credentialsPage.clearSearch')}</button></div>}
    </aside>
    <section className="mcp-tool-detail" ref={detail} aria-label={msg('mcpToolBrowser.toolDetails')} aria-live="polite">{active && guide ? <>
      <header><span className="page-label">{toolGroups.find(g => g.id === guide.group)!.label}</span><h2>{guide.title}</h2><code className="mcp-tool-name">{active}</code><p>{guide.summary}</p></header>
      <section><h3>{msg('mcpToolBrowser.inputParameters')} <span>{Object.keys(properties).length}</span></h3><div className="mcp-parameters-scroll"><table><thead><tr><th>{msg('mcpToolBrowser.parameter')}</th><th>{msg('mcpToolBrowser.typeRequired')}</th><th>{msg('mcpToolBrowser.descriptionAndLimits')}</th></tr></thead><tbody>{Object.entries(properties).map(([key, field]) => <tr key={key}><td><code>{key}</code></td><td>{field.type ?? '—'}<small>{required?.includes(key) ? msg('mcpToolBrowser.required') : msg('credentialsPage.optional')}</small></td><td>{guide.parameters[key]}<div className="mcp-parameter-limits">{field.format && <span>{field.format}</span>}{field.default !== undefined && <span>{msg('mcpToolBrowser.default')} {JSON.stringify(field.default)}</span>}{field.minimum !== undefined && <span>{msg('mcpToolBrowser.minimum')} {field.minimum}</span>}{field.maximum !== undefined && field.maximum !== Number.MAX_SAFE_INTEGER && <span>{msg('mcpToolBrowser.maximum')} {field.maximum}</span>}{field.exclusiveMinimum !== undefined && <span>{msg('mcpToolBrowser.greaterThan')} {field.exclusiveMinimum}</span>}{field.exclusiveMaximum !== undefined && <span>{msg('mcpToolBrowser.lessThan')} {field.exclusiveMaximum}</span>}{field.minLength !== undefined && <span>{msg('mcpToolBrowser.atLeast')} {field.minLength} {msg('mcpToolBrowser.characters')}</span>}{field.maxLength !== undefined && <span>{msg('logQueryDetails.atMost')} {field.maxLength} {msg('mcpToolBrowser.characters')}</span>}</div></td></tr>)}</tbody></table></div></section>
      <section><h3>{msg('mcpToolBrowser.returnedContent')}</h3><p>{guide.result}</p></section>
      <section className="mcp-tool-approval"><h3>{msg('mcpToolBrowser.authorizationAndApproval')}</h3><p>{guide.approval}</p></section>
      <section><h3>{msg('mcpToolBrowser.usageNotes')}</h3><ul>{guide.notes.map(note => <li key={note}>{note}</li>)}</ul></section>
      <section><h3>{msg('mcpToolBrowser.callArgumentExample')}</h3><small>{msg('mcpToolBrowser.staticExamplesUuidsArePlaceholders')}</small><pre>{JSON.stringify(guide.example, null, 2)}</pre></section>
      <details className="mcp-tool-protocol"><summary>{msg('mcpToolBrowser.protocolDefinitionDescriptionInputschema')}</summary><pre>{JSON.stringify(mcpToolDefinitions[active], (key, value) => key === 'inputSchema' ? schema : value, 2)}</pre></details>
    </> : <div className="mcp-tool-detail-empty"><Search size={26} /><h2>{msg('mcpToolBrowser.noMatchingTools')}</h2><p>{msg('mcpToolBrowser.tryAToolNamePurposeOrGroupName')}</p></div>}</section></div>
  </div>
}
