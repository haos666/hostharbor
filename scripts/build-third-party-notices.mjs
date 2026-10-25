import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const paths = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split(/\r?\n/).slice(1)
const entries = new Map()
for (const path of paths) {
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  const id = `${pkg.name}@${pkg.version}`
  if (entries.has(id)) continue
  const files = readdirSync(path).filter(file => /^(licen[cs]e|copying|copyright|notice)([.-]|$)/i.test(file) && statSync(join(path, file)).isFile())
  if (!files.length) throw new Error(`Review missing license text: ${id}`)
  const license = pkg.license ?? pkg.licenses?.map(item => item.type).join(' OR ')
  if (typeof license !== 'string' || !license) throw new Error(`Review missing license identifier: ${id}`)
  entries.set(id, `## ${id}\n\nLicense: ${license}\n\n${files.sort().map(file => `### ${file}\n\n\`\`\`text\n${readFileSync(join(path,file),'utf8').trim()}\n\`\`\``).join('\n\n')}`)
}
const header = '# Third-party notices\n\nGenerated from the installed production dependency tree and its distributed license/notice files. These components retain their original licenses. Electron and its Chromium dependencies are distributed separately with their own LICENSE and LICENSES.chromium.html in the application resources/licenses directory. Build-time tools are not relicensed by this document.\n\n'
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), header + [...entries.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>value).join('\n\n')+'\n')
console.log(`Generated notices for ${entries.size} production components`)
