// A bounded best-effort lexer for destructive-operation hints, NOT a shell
// validator or evaluator. Unknown syntax remains authorized in permissive mode.
export function permissiveShell(source: string): { commands: string[][]; nested: string[] } {
  const commands: string[][] = [], nested: string[] = []
  let words: string[] = [], word = '', started = false, quote = '', i = 0
  const heredocs: { delimiter: string; expand: boolean; script: boolean; tabs: boolean }[] = []
  const flushWord = () => { if (started) words.push(word); word = ''; started = false }
  const flush = () => { flushWord(); if (words.length) commands.push(words); words = [] }
  function substitution(backtick: boolean) {
    i += backtick ? 1 : 2
    const start = i; let depth = 1, q = ''
    for (; i < source.length; i++) {
      const c = source[i]
      if (c === '\\') { i++; continue }
      if (backtick) { if (c === '`') break; continue }
      if (q) { if (c === q) q = ''; continue }
      if (c === "'" || c === '"') { q = c; continue }
      if (c === '(') depth++
      if (c === ')') { depth--; if (depth === 0) break }
    }
    nested.push(source.slice(start, i)); if (i < source.length) i++
    word += '${dynamic}'; started = true
  }
  while (i < source.length) {
    const c = source[i]
    if (quote === "'") { if (c === "'") quote = ''; else word += c; started = true; i++; continue }
    if (c === '\\') { if (source[i + 1] !== '\n') word += source[i + 1] ?? ''; started = true; i += 2; continue }
    if (quote === '"' && c === '"') { quote = ''; i++; continue }
    if (!quote && (c === "'" || c === '"')) { quote = c; started = true; i++; continue }
    if (source.startsWith('${', i)) { const end = source.indexOf('}', i + 2); word += '${variable}'; started = true; i = end < 0 ? source.length : end + 1; continue }
    if (c === '`' || source.startsWith('$(', i)) { substitution(c === '`'); continue }
    if (quote) { word += c; i++; continue }
    if (c === '#' && !started) { while (i < source.length && source[i] !== '\n') i++; continue }
    if (source.startsWith('<<', i) && !source.startsWith('<<<', i)) {
      flushWord(); i += 2; const tabs = source[i] === '-'; if (tabs) i++
      while (source[i] === ' ' || source[i] === '\t') i++
      const marker = source.slice(i).match(/^(?:'([^']+)'|"([^"]+)"|([^\s;|&<>]+))/)
      if (marker) {
        const delimiter = marker[1] ?? marker[2] ?? marker[3]
        heredocs.push({ delimiter, expand: !marker[1] && !marker[2], script: words.some(w => /^(?:.*\/)?(?:bash|sh|dash|zsh)$/.test(w)), tabs }); i += marker[0].length
      }
      continue
    }
    if (c === '<' || c === '>') {
      // Redirect destinations are data, never command names.
      if (/^\d+$/.test(word)) { word = ''; started = false } else flushWord()
      while (/[<>&|]/.test(source[i] ?? '') && i < source.length) i++
      while (source[i] === ' ' || source[i] === '\t') i++
      let q = ''
      while (i < source.length) {
        const ch = source[i]
        if (q !== "'" && (ch === '`' || source.startsWith('$(', i))) { const saved: string = word, seen: boolean = started; substitution(ch === '`'); word = saved; started = seen; continue }
        if (ch === '\\') { i += 2; continue }
        if (q) { if (ch === q) q = ''; i++; continue }
        if (ch === "'" || ch === '"') { q = ch; i++; continue }
        if (/\s|[;|&()]/.test(ch)) break
        i++
      }
      continue
    }
    if (/\s/.test(c) && c !== '\n') { flushWord(); i++; continue }
    if (';|&()\n'.includes(c) || (c === '{' || c === '}') && !started && /\s|$/.test(source[i + 1] ?? '')) {
      flush(); i++
      if (c === '\n' && heredocs.length) {
        for (const h of heredocs.splice(0)) {
          const lines: string[] = []
          while (i < source.length) {
            const end = source.indexOf('\n', i), stop = end < 0 ? source.length : end
            const line = source.slice(i, stop); i = end < 0 ? source.length : end + 1
            if ((h.tabs ? line.replace(/^\t+/, '') : line) === h.delimiter) break
            lines.push(line)
          }
          if (h.script) nested.push(lines.join('\n'))
          else if (h.expand) {
            // Only command substitutions in a data heredoc are executable.
            const body = lines.join('\n')
            for (const match of body.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) nested.push(match[1] ?? match[2])
          }
        }
      }
      continue
    }
    word += c; started = true; i++
  }
  flush(); return { commands, nested }
}
